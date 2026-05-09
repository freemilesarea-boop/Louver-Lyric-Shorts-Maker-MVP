import { app } from 'electron';
import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// In packaged builds, ffmpeg-static / ffprobe-static binaries live inside
// app.asar.unpacked. We rewrite the path so spawn() can actually launch them.
function unpacked(p: string | null | undefined): string {
  if (!p) return '';
  if (app.isPackaged) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

const ffmpegResolved = unpacked(ffmpegStatic as unknown as string);
const ffprobeResolved = unpacked(ffprobeStatic.path);

if (!ffmpegResolved || !existsSync(ffmpegResolved)) {
  // eslint-disable-next-line no-console
  console.warn('[binaries] ffmpeg binary not found at', ffmpegResolved);
}
if (!ffprobeResolved || !existsSync(ffprobeResolved)) {
  // eslint-disable-next-line no-console
  console.warn('[binaries] ffprobe binary not found at', ffprobeResolved);
}

export const ffmpegPath = ffmpegResolved;
export const ffprobePath = ffprobeResolved;
