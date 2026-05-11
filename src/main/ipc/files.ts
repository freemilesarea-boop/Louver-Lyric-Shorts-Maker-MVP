import { dialog, IpcMain, BrowserWindow, app } from 'electron';
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, ffprobePath } from '../render/binaries';
import { analyzeAmplitude } from '../audio/analyze';
import {
  WhisperNotInstalledError,
  cancelActiveTranscription,
  detectWhisperBinary,
  transcribe,
} from '../audio/transcribe';
import { prettyErrorMessage } from '../../shared/errors';
import {
  deletePreset,
  listPresets,
  savePreset,
  type SaveInput,
} from '../storage/customPresets';
import { loadBundledFonts } from '../storage/fontFiles';
import { pathToMediaUrl, readImageAsDataURL } from './mediaUrl';
import {
  isSupportedForPreview,
  probeMedia,
  recommendedTranscodeArgs,
  type MediaProbe,
} from './mediaProbe';
import type { AudioMeta, LanguageCode, LyricLine } from '../../shared/types';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
// Phase 5-6: GIF supported now (treated as a short looping video stream
// by ffmpeg). Video extensions (mp4/mov/m4v/webm) are reserved here so
// the file picker already accepts them; the actual video render path
// lands in Phase 5-7.
const GIF_EXTS = ['gif'];
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm'];
const MAIN_MEDIA_EXTS = [...IMAGE_EXTS, ...GIF_EXTS, ...VIDEO_EXTS];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];

export function registerFileHandlers(
  ipcMain: IpcMain,
  getWin: () => BrowserWindow | null,
): void {
  // Renamed conceptually to "main media" — accepts images, gifs, and
  // (Phase 5-7) videos. IPC channel name kept as 'files:pickImage' for
  // backward compat with the preload bridge.
  ipcMain.handle('files:pickImage', async () => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: '메인 사진 / 영상 선택',
      properties: ['openFile'],
      filters: [
        { name: '사진 / 영상 / GIF', extensions: MAIN_MEDIA_EXTS },
        { name: '사진만', extensions: IMAGE_EXTS },
        { name: 'GIF / 영상', extensions: [...GIF_EXTS, ...VIDEO_EXTS] },
      ],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('files:pickAudio', async () => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Select an audio file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTS }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('files:pickOutputDir', async () => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Select output folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('files:probeAudio', async (_e, audioPath: string): Promise<AudioMeta> => {
    return probeDuration(audioPath);
  });

  // Phase 5-8.1 — probe a main-media file (mp4/mov/webm/gif) and tell
  // the renderer whether Chromium's <video> can decode it for preview.
  // Used by the StartScreen / LivePreview validation banner to either
  // proceed straight to preview or surface a "변환하기" affordance.
  ipcMain.handle(
    'files:probeMedia',
    async (
      _e,
      mediaPath: string,
    ): Promise<{
      probe: MediaProbe;
      supported: boolean;
      reason: string;
    }> => {
      const probe = await probeMedia(mediaPath, ffprobePath);
      const verdict = isSupportedForPreview(probe);
      return { probe, supported: verdict.supported, reason: verdict.reason };
    },
  );

  // Phase 5-8.1 — transcode an arbitrary input video into a
  // preview-friendly MP4 (libx264 / yuv420p / -an). The output lands
  // under app.getPath('temp') so it's automatically cleaned when the
  // OS rotates temp space. Returns the absolute path the renderer can
  // hand back to setImage(). Progress events are emitted on the
  // 'transcode:progress' channel so the UI can show a percent bar.
  ipcMain.handle(
    'files:transcodeMainMedia',
    async (
      _e,
      srcPath: string,
    ): Promise<{ ok: true; outputPath: string } | { ok: false; error: string }> => {
      const tmpRoot = await fs.mkdtemp(
        join(app.getPath('temp'), 'lyric-shorts-transcode-'),
      );
      const outputPath = join(tmpRoot, 'converted-main-media.mp4');
      const args = recommendedTranscodeArgs(srcPath, outputPath);
      try {
        await runFfmpegTranscode(args, getWin);
        // Phase 5-8.2 — verify the OUTPUT actually probes as
        // preview-friendly before reporting success. This catches the
        // pathological case where ffmpeg returns 0 but the produced
        // file has zero video streams (corrupted source) or somehow
        // ends up with an unsupported codec/pixfmt anyway.
        const probe = await probeMedia(outputPath, ffprobePath);
        const verdict = isSupportedForPreview(probe);
        if (!verdict.supported) {
          return {
            ok: false,
            error:
              `변환된 파일이 여전히 미리보기에서 지원되지 않아요 ` +
              `(${probe.videoCodec ?? 'no-video'} · ${probe.pixelFormat ?? 'no-pixfmt'}). ` +
              `원본 파일이 손상되었을 수 있어요. 자세한 사유: ${verdict.reason}`,
          };
        }
        return { ok: true, outputPath };
      } catch (err) {
        return { ok: false, error: prettyErrorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'audio:analyzeAmplitude',
    async (_e, audioPath: string, startSec: number, durationSec: number) => {
      return analyzeAmplitude(audioPath, startSec, durationSec);
    },
  );

  ipcMain.handle('audio:whisperAvailable', () => {
    const bin = detectWhisperBinary();
    return bin ? { ok: true, kind: bin.kind } : { ok: false };
  });

  ipcMain.handle(
    'audio:transcribe',
    async (
      _e,
      args: {
        audioPath: string;
        startSec: number;
        durationSec: number;
        languageHint?: LanguageCode | 'auto';
      },
    ): Promise<{
      ok: boolean;
      lines?: LyricLine[];
      language?: string;
      error?: string;
      notInstalled?: boolean;
    }> => {
      try {
        const result = await transcribe(args);
        return {
          ok: true,
          lines: result.lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
          language: result.language,
        };
      } catch (err) {
        if (err instanceof WhisperNotInstalledError) {
          return {
            ok: false,
            notInstalled: true,
            error:
              'Whisper가 설치되어 있지 않습니다. 자동 가사 추출을 사용하려면 ' +
              'OpenAI Whisper(`pip install openai-whisper`) 또는 whisper.cpp를 ' +
              '시스템에 설치한 뒤 다시 시도해주세요.',
          };
        }
        return { ok: false, error: prettyErrorMessage(err) };
      }
    },
  );

  ipcMain.handle('audio:cancelTranscribe', () => {
    return cancelActiveTranscription();
  });

  ipcMain.handle('presets:list', () => listPresets());
  ipcMain.handle('presets:save', (_e, input: SaveInput) => savePreset(input));
  ipcMain.handle('presets:delete', (_e, id: string) => deletePreset(id));

  ipcMain.handle('fonts:loadBundled', () => loadBundledFonts());

  // Phase 5-6.1: image-only + 10MB cap. Renderer must use toMediaUrl for
  // gif/video/audio so we don't blow V8's max-string limit.
  ipcMain.handle('files:readAsDataURL', (_e, path: string) => {
    return readImageAsDataURL(path);
  });

  // Returns a `media://` URL the renderer can drop into <img>/<video>/
  // <audio> src. Backed by the privileged scheme registered in main/index
  // — net.fetch streams the file directly, no base64 in JS land.
  ipcMain.handle('files:toMediaUrl', (_e, path: string) => {
    return pathToMediaUrl(path);
  });

  ipcMain.handle('files:defaultOutputDir', async () => {
    const dir = app.getPath('videos');
    const sub = join(dir, 'LyricShorts');
    await fs.mkdir(sub, { recursive: true });
    return sub;
  });

  ipcMain.handle('files:exists', async (_e, p: string) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('files:basename', (_e, p: string) => basename(p));
}

/**
 * Phase 5-8.1 — run ffmpeg for the transcode IPC. Parses `out_time_ms`
 * from `-progress pipe:2` so the renderer can show a percent bar; the
 * total duration is read once from the input via a one-shot ffprobe so
 * we don't have to keep state across events.
 */
async function runFfmpegTranscode(
  args: string[],
  getWin: () => BrowserWindow | null,
): Promise<void> {
  // Add progress reporting via stderr so we don't compete with the
  // user's `-vf scale=...` filter graph on stdout. ffmpeg's -progress
  // writes structured key=value pairs; we parse out_time_ms and
  // forward it as `transcode:progress` IPC events.
  const augmented = [...args, '-progress', 'pipe:2', '-nostats'];
  // ffmpeg's source path is at index 2 (after -y -i). We probe its
  // duration so percent = out_time_ms / total can be reported.
  const srcIdx = augmented.indexOf('-i') + 1;
  const sourceDurationSec = srcIdx > 0
    ? await probeSourceDurationSec(augmented[srcIdx])
    : 0;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, augmented);
    let stderrTail = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      // Keep a rolling tail of stderr so we can include real errors in
      // the rejection. ffmpeg emits a LOT, so cap at 4 KB.
      stderrTail = (stderrTail + text).slice(-4096);
      // Parse progress lines.
      const m = text.match(/out_time_ms=(\d+)/);
      if (m && sourceDurationSec > 0) {
        const outSec = parseInt(m[1], 10) / 1_000_000;
        const pct = Math.max(0, Math.min(100, (outSec / sourceDurationSec) * 100));
        const win = getWin();
        if (win) win.webContents.send('transcode:progress', { percent: pct });
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        const win = getWin();
        if (win) win.webContents.send('transcode:progress', { percent: 100 });
        resolve();
        return;
      }
      reject(
        new Error(
          `ffmpeg transcode failed (exit ${code}): ${stderrTail.slice(-800)}`,
        ),
      );
    });
  });
}

function probeSourceDurationSec(path: string): Promise<number> {
  return probeDuration(path).then((m) => m.durationSec).catch(() => 0);
}

function probeDuration(path: string): Promise<AudioMeta> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ];
    const child = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr || `exit ${code}`}`));
        return;
      }
      const sec = parseFloat(stdout.trim());
      if (!Number.isFinite(sec)) {
        reject(new Error(`Could not parse duration from ffprobe output: ${stdout}`));
        return;
      }
      resolve({ durationSec: sec });
    });
  });
}
