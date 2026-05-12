import { ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from './binaries';
import { buildFilterGraph, type OverlayTiming } from './filters';
import { progressBarGeom } from '../../shared/playerChrome';
import type { RenderRequest, RenderTimings } from '../../shared/types';

const TARGET_W = 1080;
const TARGET_H = 1920;
const FPS = 30;

export interface RenderOk {
  outputPath: string;
  timings: RenderTimings;
}

/**
 * Tracks the in-flight ffmpeg child so the IPC layer can request cancellation.
 * Only one render runs at a time.
 */
let activeChild: ChildProcess | null = null;

export function cancelActiveRender(): boolean {
  if (!activeChild) return false;
  try {
    activeChild.kill('SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export async function runRender(
  req: RenderRequest,
  outputPath: string,
  onProgress: (percent: number) => void,
): Promise<RenderOk> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg 바이너리를 찾을 수 없습니다. ffmpeg-static 설치를 확인하세요.');
  }

  // Probe inputs.
  await assertReadable(req.imagePath, '메인 사진');
  await assertReadable(req.audioPath, '오디오');
  if (req.backgroundImagePath) {
    await assertReadable(req.backgroundImagePath, '배경 사진');
  }

  // Probe output dir is writable.
  const outDir = dirname(outputPath);
  await assertWritableDir(outDir);

  const tempDir = await fs.mkdtemp(join(tmpdir(), 'lyric-shorts-'));
  const totalStart = Date.now();
  try {
    // 1. Materialize PNG overlays to disk so ffmpeg can read them as inputs.
    const overlayMaterializeStart = Date.now();
    const overlayPaths: string[] = [];
    const overlays = req.overlays ?? [];
    for (let i = 0; i < overlays.length; i++) {
      const buf = Buffer.from(overlays[i].base64, 'base64');
      const p = join(tempDir, `ov_${i}.png`);
      await fs.writeFile(p, buf);
      overlayPaths.push(p);
    }
    const overlayMaterializeMs = Date.now() - overlayMaterializeStart;

    // 2. Build filter graph.
    //    Input ordering:
    //      0 = main image (looped at fps so motion can sample frames)
    //      1 = audio (with -ss / -t for clip range)
    //      2 = background image (when backgroundImagePath set, looped)
    //      next..N = overlay PNGs (single-frame each)
    //    Overlay indices shift by +1 when a background is present.
    const hasBackground = !!req.backgroundImagePath;
    const overlayBaseIdx = hasBackground ? 3 : 2;
    const overlayTimings: OverlayTiming[] = overlays.map((ov, i) => ({
      inputIndex: overlayBaseIdx + i,
      startSec: clamp(ov.startSec, 0, req.durationSec),
      endSec: clamp(ov.endSec, 0, req.durationSec),
    }));
    const motionPreset = req.motionPreset ?? req.template.motionPreset ?? 'none';
    const filter = buildFilterGraph({
      width: TARGET_W,
      height: TARGET_H,
      fps: FPS,
      durationSec: req.durationSec,
      template: req.template,
      overlays: overlayTimings,
      motionPreset,
      backgroundInputIndex: hasBackground ? 2 : null,
      mainScale: req.styleOverrides?.mainScale ?? 1,
      // When the template has player chrome, hand the progress-bar
      // geometry to filters.ts so it can paint a smooth per-frame bar
      // via drawbox + t/dur expression. No-op for templates without
      // a player chrome.
      playerProgressGeom: progressBarGeom(req.template.playerChrome ?? null),
      // Phase 5-7 — user toggles for waveform / player chrome visibility
      // and the amplitude curve that drives the equalizer bars.
      styleOverrides: req.styleOverrides ?? null,
      amplitudeCurve: req.amplitudeCurve ?? null,
    });
    const filterScriptPath = join(tempDir, 'filter.txt');
    await fs.writeFile(filterScriptPath, filter, 'utf8');

    // 3. Compose ffmpeg argv. Args are passed as an array (no shell), so spaces
    //    and Korean characters in paths are handled safely on Windows/macOS.
    const args: string[] = ['-y'];
    // Phase 5-6: main media input branches on kind.
    //   - 'image'  → still input, `-loop 1 -framerate N` so the still
    //                stretches to fill the output duration.
    //   - 'gif' / 'video' → animated source. Apply optional source-time
    //                trim (`-ss start` BEFORE `-i` for fast seek, with
    //                `-t length` AFTER) and `-stream_loop -1` so a
    //                source shorter than the output keeps looping. The
    //                pipeline's final `-t req.durationSec` caps total
    //                output length so we never run past the user's
    //                selected clip length.
    const mediaKind = req.mainMediaKind ?? 'image';
    if (mediaKind === 'image') {
      args.push('-loop', '1', '-framerate', String(FPS), '-i', req.imagePath);
    } else {
      // For gif/video, `-stream_loop -1` BEFORE `-i` loops the demuxed
      // packets indefinitely. Source-time trim (sourceStartSec /
      // sourceEndSec) optionally narrows the window the user wants
      // from the file before looping kicks in.
      args.push('-stream_loop', '-1');
      if (
        req.mainMediaSourceStartSec != null &&
        req.mainMediaSourceStartSec > 0
      ) {
        args.push('-ss', String(req.mainMediaSourceStartSec));
      }
      if (req.mainMediaSourceEndSec != null && req.mainMediaSourceStartSec != null) {
        const len = Math.max(
          0.1,
          req.mainMediaSourceEndSec - req.mainMediaSourceStartSec,
        );
        args.push('-t', String(len));
      }
      args.push('-i', req.imagePath);
    }
    args.push(
      '-ss', String(Math.max(0, req.startSec)),
      '-t', String(req.durationSec),
      '-i', req.audioPath,
    );
    if (req.backgroundImagePath) {
      args.push('-loop', '1', '-framerate', String(FPS), '-i', req.backgroundImagePath);
    }
    // Overlay PNGs are fed as single-frame inputs (no -loop). The overlay
    // filter's `enable=between(t,a,b)` gates when each is drawn; outside
    // its window it simply doesn't paint. Looping these via `-loop 1
    // -framerate N` causes ffmpeg to queue duplicated frames per input
    // until the encoder consumes them, which scales memory linearly with
    // overlay count × (duration*fps) and OOM-killed renders with many
    // overlays in the QA matrix.
    for (const p of overlayPaths) {
      args.push('-i', p);
    }
    args.push('-filter_complex_script', filterScriptPath);
    args.push('-map', '[vout]', '-map', '1:a');
    args.push('-r', String(FPS));
    args.push('-t', String(req.durationSec));
    // Encode params come from the export preset bundle when set; otherwise
    // fall back to the historical defaults so legacy callers (and the
    // renderer-side preview path) keep working unchanged.
    const enc = req.exportEncode;
    const videoPreset = enc?.videoPreset ?? 'medium';
    const videoCrf = enc?.videoCrf ?? 20;
    const audioBitrateKbps = enc?.audioBitrateKbps ?? 192;
    args.push('-c:v', 'libx264', '-preset', videoPreset, '-crf', String(videoCrf));
    args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    args.push('-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`, '-ar', '44100');
    args.push('-shortest');
    args.push('-progress', 'pipe:1');
    args.push(outputPath);

    const ffmpegStart = Date.now();
    await runFfmpeg(args, req.durationSec, onProgress);
    const ffmpegMs = Date.now() - ffmpegStart;

    let outputSizeBytes = 0;
    try {
      outputSizeBytes = (await fs.stat(outputPath)).size;
    } catch {
      // Stat may fail if ffmpeg killed mid-write; fall back to 0.
    }

    const timings: RenderTimings = {
      ffmpegMs,
      overlayMaterializeMs,
      totalMs: Date.now() - totalStart,
      outputSizeBytes,
      overlayCount: overlays.length,
    };

    // eslint-disable-next-line no-console
    console.log(
      `[render] done · overlays=${overlays.length} ` +
        `(${overlayMaterializeMs}ms) · ffmpeg=${ffmpegMs}ms · total=${timings.totalMs}ms ` +
        `· output=${(outputSizeBytes / 1024).toFixed(0)}KB`,
    );
    return { outputPath, timings };
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(
  args: string[],
  durationSec: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    activeChild = child;
    let stderr = '';
    let cancelled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key === 'out_time_ms') {
          const ms = parseInt(val, 10);
          if (Number.isFinite(ms)) {
            const pct = Math.max(0, Math.min(99, (ms / 1000 / durationSec) * 100));
            onProgress(pct);
          }
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on('error', (err) => {
      activeChild = null;
      reject(new Error(`ffmpeg 실행 실패: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      activeChild = null;
      if (cancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new RenderCancelled());
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `ffmpeg 렌더 실패 (exit ${code}). 마지막 로그:\n${stderr.slice(-2000)}`,
        ),
      );
    });
    // If somebody cancels via cancelActiveRender(), we'll see the SIGTERM via signal.
    child.once('SIGTERM' as never, () => {
      cancelled = true;
    });
  });
}

export class RenderCancelled extends Error {
  constructor() {
    super('Render cancelled by user.');
    this.name = 'RenderCancelled';
  }
}

async function assertReadable(path: string, label: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    throw new Error(`${label} 파일을 찾을 수 없습니다: ${path}`);
  }
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) {
      throw new Error(`${label} 경로가 파일이 아닙니다: ${path}`);
    }
    if (stat.size === 0) {
      throw new Error(`${label} 파일이 비어 있습니다: ${path}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${label} `)) throw e;
    throw new Error(
      `${label} 파일 읽기 실패: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function assertWritableDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true }).catch((e) => {
    throw new Error(`출력 폴더를 만들 수 없습니다 (${dir}): ${e.message}`);
  });
  // Probe with a temp file.
  const probe = join(dir, `.__write_probe_${Date.now()}`);
  try {
    await fs.writeFile(probe, '');
    await fs.unlink(probe);
  } catch (e) {
    throw new Error(
      `출력 폴더에 쓰기 권한이 없습니다 (${dir}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : '.';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
