import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Pure helpers for renderer-side media loading. Kept separate from
 * files.ts so tests can import them without Electron in scope.
 *
 * Phase 5-6.1: the original `files:readAsDataURL` happily base64'd
 * arbitrary files. For images that's fine, but a 50MB MP4 produces a
 * ~67MB base64 string — and a 400MB MP4 blows past V8's 0x1fffffe8
 * single-string cap and crashes the IPC. The fix is two-pronged:
 *
 *  - readImageAsDataURL: only images, only ≤10MB.
 *  - pathToMediaUrl: returns a `media://` URL the renderer can drop
 *    straight into <img>/<video>/<audio> src. The main process
 *    registers a privileged `media://` protocol that streams the file
 *    via Electron's net.fetch — no base64, no full-file buffering.
 */

export const DATAURL_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;
export const DATAURL_MAX_BYTES = 10 * 1024 * 1024;

export function guessMime(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
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

export class DataUrlRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUrlRefusedError';
  }
}

/**
 * Convert an image file to a data: URL. Refuses non-image extensions
 * and any file larger than DATAURL_MAX_BYTES so we never push V8 toward
 * its single-string limit.
 */
export async function readImageAsDataURL(path: string): Promise<string> {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (!(DATAURL_IMAGE_EXTS as readonly string[]).includes(ext)) {
    throw new DataUrlRefusedError(
      `readAsDataURL refuses .${ext || '(none)'} — use toMediaUrl for gif / video / audio.`,
    );
  }
  const stat = await fs.stat(path);
  if (stat.size > DATAURL_MAX_BYTES) {
    throw new DataUrlRefusedError(
      `File too large for DataURL (${(stat.size / 1024 / 1024).toFixed(1)}MB > 10MB) — use toMediaUrl.`,
    );
  }
  const data = await fs.readFile(path);
  return `data:${guessMime(ext)};base64,${data.toString('base64')}`;
}

/**
 * Encode an absolute filesystem path as a `media://` URL. The transform
 * is `pathToFileURL(p) → swap 'file:' → 'media:'` so it round-trips
 * cleanly in the protocol handler (which does the reverse swap and
 * delegates to net.fetch). Handles Windows drive letters and Unicode /
 * spaced paths via the standard URL encoding pathToFileURL applies.
 */
export function pathToMediaUrl(path: string): string {
  const fileUrl = pathToFileURL(path).toString();
  return fileUrl.replace(/^file:/, 'media:');
}

/** Reverse of pathToMediaUrl — used by the protocol handler. */
export function mediaUrlToFileUrl(mediaUrl: string): string {
  return mediaUrl.replace(/^media:/, 'file:');
}

/**
 * Phase 5-8.6 — direct `file://` URL for the renderer to drop into
 * <img>/<video>/<audio> src. This bypasses the media:// custom
 * protocol entirely. webSecurity=false in BrowserWindow allows the
 * renderer to load file:// URLs. The standard library handles all
 * the path encoding (spaces, %, #, ?, Unicode) so we don't have to.
 */
export function pathToFileUrl(path: string): string {
  return pathToFileURL(path).toString();
}
