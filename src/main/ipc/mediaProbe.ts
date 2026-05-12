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
 * Shorts-canvas MP4 the Electron <video> element accepts without
 * pre-roll quirks.
 *
 * Phase 5-8.5 — overhauled to the user's explicit spec after Phase
 * 5-8.4's baseline/no-audio combo still tripped some Chromium decode
 * paths. Highlights:
 *
 *   - `scale=1080:1920:force_original_aspect_ratio=increase,
 *      crop=1080:1920`     fill the canvas (visible crop only on
 *                          aspect mismatch; for 9:16 sources this is
 *                          a no-op trim)
 *   - `fps=30`             pin a fixed frame rate so the muxer always
 *                          writes a clean timebase
 *   - `format=yuv420p`     8-bit hard requirement inside the filter
 *   - `-c:v libx264 -profile:v main -level 4.0 -preset veryfast`
 *                          main profile has better quality at the
 *                          same bitrate than baseline AND is just as
 *                          widely supported by Chromium decoders
 *   - `-pix_fmt yuv420p`   belt + suspenders alongside the filter
 *   - `-movflags +faststart`
 *                          moov atom at the front — the single
 *                          biggest fix for "h264 file but won't play"
 *   - `-c:a aac -b:a 192k -ar 48000 -ac 2`
 *                          force AAC stereo 48kHz. Some Chromium
 *                          builds get confused by MP4s with audio
 *                          stream codec mismatches; standardizing
 *                          ducks the issue.
 *
 * Silent inputs (GIF, video-only MP4): when `hasAudio` is false the
 * caller MUST prepend `-f lavfi -i anullsrc=channel_layout=stereo:
 * sample_rate=48000` and remap audio from input 1. We expose that as
 * a separate helper so the caller can introspect both branches.
 */
export interface BuildTranscodeArgsOpts {
  srcPath: string;
  destPath: string;
  /** Whether the source has at least one audio stream. Drives the
   *  anullsrc fallback below. */
  hasAudio: boolean;
}

export function recommendedTranscodeArgs(opts: BuildTranscodeArgsOpts): string[] {
  const args: string[] = ['-y', '-i', opts.srcPath];
  if (!opts.hasAudio) {
    // Generate silent AAC-shaped audio. anullsrc itself is infinite;
    // -shortest below caps at video duration. Chromium decoders behave
    // more predictably when an MP4 has BOTH video + audio streams.
    args.push(
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
    );
  }
  args.push(
    '-map',
    '0:v:0',
    '-map',
    opts.hasAudio ? '0:a:0' : '1:a:0',
    '-vf',
    'scale=1080:1920:force_original_aspect_ratio=increase,' +
      'crop=1080:1920,' +
      'fps=30,' +
      'format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    opts.destPath,
  );
  return args;
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
