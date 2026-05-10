import { app } from 'electron';
import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// In packaged builds, ffmpeg-static / ffprobe-static binaries live inside
// app.asar.unpacked. We rewrite the path so spawn() can actually launch them.
//
// Safe in non-Electron contexts (e.g. tsx-driven test scripts) too — when
// `app` is unavailable we just return the raw path. The unit-test demo
// pack and smoke scripts depend on this.
function unpacked(p: string | null | undefined): string {
  if (!p) return '';
  const isPackaged = (() => {
    try {
      return app?.isPackaged ?? false;
    } catch {
      return false;
    }
  })();
  if (isPackaged) {
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
