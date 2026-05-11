import { spawn } from 'node:child_process';

/**
 * Phase 5-8.1 — ffprobe-driven media validation + transcode planning.
 *
 * The Chromium <video> element doesn't accept every container/codec
 * combo. The bare error we surfaced before — "code=4 Format error,
 * videoWidth=0" — happens when the file is reachable but the codec
 * (HEVC / ProRes / AV1) or pixel format (yuv420p10le / yuv422p10le)
 * isn't in Chromium's decode list. Rather than make the user guess,
 * we probe the file at pick time with ffprobe-static and either:
 *
 *   - declare it supported → preview straight away, or
 *   - declare it unsupported → surface the detected codec /
 *     resolution / pixel format AND offer a one-click "권장 형식으로
 *     변환" using ffmpeg → libx264 yuv420p.
 *
 * The helpers here are PURE (no Electron import) so the smoke test
 * can import them directly from node.
 */

export interface MediaProbe {
  /** Container short name from ffprobe (e.g. "mov,mp4,m4a,3gp,3g2,mj2"
   *  → we keep the first comma-separated entry as a hint). */
  format: string;
  videoCodec: string | null;
  audioCodec: string | null;
  /** ffprobe `pix_fmt` for the first video stream. yuv420p is the
   *  baseline Chromium accepts; 10-bit variants do not work. */
  pixelFormat: string | null;
  durationSec: number;
  width: number;
  height: number;
  /** Frames per second derived from `r_frame_rate` (a fraction). */
  frameRate: number;
  hasAudio: boolean;
}

export interface SupportVerdict {
  supported: boolean;
  /** Human-readable Korean explanation. Empty when supported. */
  reason: string;
}

const SUPPORTED_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'gif']);
// Chromium decodes 8-bit yuv420p reliably across all platforms; 10-bit
// (yuv420p10le, yuv422p10le, yuv444p10le) is unsupported for software
// decode. yuvj420p is the JPEG-range variant of yuv420p and works.
const SUPPORTED_PIXEL_FORMATS = new Set([
  'yuv420p',
  'yuvj420p',
  'yuv422p',
  'yuv444p',
  // GIFs report bgra / pal8 — both work in <img> / <video>.
  'bgra',
  'pal8',
]);

/**
 * Classify a probed file against the Chromium preview support matrix.
 * Returns supported=true only when ALL of:
 *   - duration > 0
 *   - width and height > 0
 *   - video codec is in our allowlist
 *   - pixel format is 8-bit (or palette / bgra for gif)
 */
export function isSupportedForPreview(probe: MediaProbe): SupportVerdict {
  if (probe.durationSec <= 0 || !Number.isFinite(probe.durationSec)) {
    return { supported: false, reason: '재생 길이를 확인할 수 없습니다.' };
  }
  if (probe.width <= 0 || probe.height <= 0) {
    return { supported: false, reason: '영상 크기를 확인할 수 없습니다.' };
  }
  if (!probe.videoCodec) {
    return { supported: false, reason: '비디오 스트림을 찾을 수 없습니다.' };
  }
  if (!SUPPORTED_VIDEO_CODECS.has(probe.videoCodec)) {
    return {
      supported: false,
      reason:
        `미리보기에서 지원하지 않는 비디오 코덱이에요 (${probe.videoCodec}). ` +
        `MP4 / H.264 / yuv420p로 변환하면 재생할 수 있습니다.`,
    };
  }
  if (probe.pixelFormat && !SUPPORTED_PIXEL_FORMATS.has(probe.pixelFormat)) {
    return {
      supported: false,
      reason:
        `미리보기가 지원하지 않는 픽셀 포맷이에요 (${probe.pixelFormat}). ` +
        `보통 10-bit 영상에서 발생합니다 — 8-bit yuv420p로 변환하면 재생됩니다.`,
    };
  }
  return { supported: true, reason: '' };
}

/**
 * Build the ffmpeg argv that transcodes an arbitrary input into a
 * preview-friendly MP4. We:
 *   - downscale only when the long edge exceeds 1920px (matches the
 *     export pipeline's target). Smaller files pass through unchanged.
 *   - force yuv420p so 10-bit / non-standard pixel formats become
 *     Chromium-decodable.
 *   - libx264 fast/crf 20 — visually equivalent to the export
 *     pipeline's medium-quality preset, completes in seconds.
 *   - drop the audio track (`-an`) since the user's own audio file is
 *     the only audio source the render uses. Avoids carrying along
 *     HEVC's HE-AAC, EAC3, ProRes PCM, etc that Chromium audio could
 *     also refuse.
 *
 * The `scale=` expression preserves aspect ratio — no crop, no
 * letterbox. The preview / export pipeline handles cover-cropping at
 * paint time.
 */
export function recommendedTranscodeArgs(
  srcPath: string,
  destPath: string,
): string[] {
  return [
    '-y',
    '-i',
    srcPath,
    '-vf',
    "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',format=yuv420p",
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    destPath,
  ];
}

/**
 * Run ffprobe and return a typed MediaProbe. The probe uses the
 * structured JSON output (`-print_format json`) so we don't have to
 * parse free-form text. Throws a friendly Error on failure (used by
 * the IPC layer for the renderer's catch block).
 */
export function probeMedia(
  path: string,
  ffprobeBin: string,
): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ];
    const child = spawn(ffprobeBin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (${code}): ${stderr.slice(-400)}`));
        return;
      }
      try {
        resolve(parseProbe(stdout));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/** Pure parser — exposed for tests so we don't need ffprobe in scope. */
export function parseProbe(stdoutJson: string): MediaProbe {
  const parsed = JSON.parse(stdoutJson) as {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const format = (parsed.format?.format_name ?? '').split(',')[0] ?? '';
  const durationSec =
    parseFloat(parsed.format?.duration ?? video?.duration ?? '0') || 0;
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const frameRate = (() => {
    const r = video?.r_frame_rate ?? '0/0';
    const [num, den] = r.split('/').map((x) => parseFloat(x));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return num / den;
  })();
  return {
    format,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    durationSec,
    width,
    height,
    frameRate,
    hasAudio: !!audio,
  };
}
