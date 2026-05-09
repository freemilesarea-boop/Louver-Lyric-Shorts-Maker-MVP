import { spawn } from 'node:child_process';
import { ffmpegPath } from '../render/binaries';
import { buildAmplitudeCurve } from '../../shared/audioReactive';
import type { AmplitudeCurve } from '../../shared/types';

const PCM_RATE = 8000;
const INTERVAL_SEC = 0.05;

/**
 * Extract a normalized amplitude curve from `audioPath` over `[startSec,
 * startSec+durationSec]`. Decodes mono float32 PCM at 8kHz via ffmpeg, runs
 * the shared RMS+smooth+normalize pipeline.
 *
 * Result size is bounded (~20 samples/sec × 60s max = 1200 floats), small
 * enough to ship over IPC and reuse for both preview and export.
 */
export async function analyzeAmplitude(
  audioPath: string,
  startSec: number,
  durationSec: number,
): Promise<AmplitudeCurve> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found.');
  }
  if (durationSec <= 0) {
    return { intervalSec: INTERVAL_SEC, values: [], durationSec: 0 };
  }

  const pcm = await runFfmpegToBuffer([
    '-loglevel', 'error',
    '-ss', String(Math.max(0, startSec)),
    '-t', String(durationSec),
    '-i', audioPath,
    '-vn',
    '-ac', '1',
    '-ar', String(PCM_RATE),
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    'pipe:1',
  ]);

  // Wrap into a Float32Array view. Buffer is byte-aligned to 4 since
  // pcm_f32le frames are 4 bytes each.
  const aligned = pcm.byteLength - (pcm.byteLength % 4);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, aligned / 4);
  return buildAmplitudeCurve(samples, PCM_RATE, durationSec, INTERVAL_SEC);
}

function runFfmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(
          new Error(
            `ffmpeg PCM decode failed (exit ${code}). Last log:\n${stderr.slice(-1500)}`,
          ),
        );
      }
    });
  });
}
