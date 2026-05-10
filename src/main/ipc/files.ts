import { dialog, IpcMain, BrowserWindow, app } from 'electron';
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { ffprobePath } from '../render/binaries';
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
import type { AudioMeta, LanguageCode, LyricLine } from '../../shared/types';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];

export function registerFileHandlers(
  ipcMain: IpcMain,
  getWin: () => BrowserWindow | null,
): void {
  ipcMain.handle('files:pickImage', async () => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Select an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
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

  ipcMain.handle('files:readAsDataURL', async (_e, path: string) => {
    const data = await fs.readFile(path);
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = guessMime(ext);
    return `data:${mime};base64,${data.toString('base64')}`;
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

function guessMime(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
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
