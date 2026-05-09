import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from './binaries';
import { buildFilterGraph, type OverlayTiming } from './filters';
import type { RenderRequest } from '../../shared/types';

const TARGET_W = 1080;
const TARGET_H = 1920;
const FPS = 30;

export interface RenderOk {
  outputPath: string;
}

export async function runRender(
  req: RenderRequest,
  outputPath: string,
  onProgress: (percent: number) => void,
): Promise<RenderOk> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found.');

  await fs.access(req.imagePath).catch(() => {
    throw new Error(`Image not found: ${req.imagePath}`);
  });
  await fs.access(req.audioPath).catch(() => {
    throw new Error(`Audio not found: ${req.audioPath}`);
  });

  const tempDir = await fs.mkdtemp(join(tmpdir(), 'lyric-shorts-'));
  try {
    // 1. Materialize PNG overlays to disk so ffmpeg can read them as inputs.
    const overlayPaths: string[] = [];
    const overlays = req.overlays ?? [];
    for (let i = 0; i < overlays.length; i++) {
      const buf = Buffer.from(overlays[i].base64, 'base64');
      const p = join(tempDir, `ov_${i}.png`);
      await fs.writeFile(p, buf);
      overlayPaths.push(p);
    }

    // 2. Build filter graph. Inputs are: 0=image, 1=audio, 2..N=overlays.
    const overlayTimings: OverlayTiming[] = overlays.map((ov, i) => ({
      inputIndex: 2 + i,
      startSec: Math.max(0, ov.startSec),
      endSec: Math.min(req.durationSec, ov.endSec),
    }));
    const filter = buildFilterGraph({
      width: TARGET_W,
      height: TARGET_H,
      fps: FPS,
      durationSec: req.durationSec,
      template: req.template,
      overlays: overlayTimings,
    });
    const filterScriptPath = join(tempDir, 'filter.txt');
    await fs.writeFile(filterScriptPath, filter, 'utf8');

    // 3. Compose ffmpeg argv.
    const args: string[] = ['-y'];
    // Image (looped).
    args.push('-loop', '1', '-framerate', String(FPS), '-i', req.imagePath);
    // Audio (trimmed).
    args.push(
      '-ss', String(Math.max(0, req.startSec)),
      '-t', String(req.durationSec),
      '-i', req.audioPath,
    );
    // Overlay PNG inputs (each looped for full duration so overlay can show
    // them at any time gated by `enable=`).
    for (const p of overlayPaths) {
      args.push('-loop', '1', '-framerate', String(FPS), '-i', p);
    }

    args.push('-filter_complex_script', filterScriptPath);
    args.push('-map', '[vout]', '-map', '1:a');
    args.push('-r', String(FPS));
    args.push('-t', String(req.durationSec));
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20');
    args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
    args.push('-shortest');
    args.push('-progress', 'pipe:1');
    args.push(outputPath);

    await runFfmpeg(args, req.durationSec, onProgress);
    return { outputPath };
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
    let stderr = '';
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
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (exit ${code}). Last log:\n${stderr.slice(-2000)}`));
      }
    });
  });
}
