import { createReadStream, promises as fs } from 'node:fs';
import { open as fsOpen } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mediaUrlToFileUrl, guessMime } from './mediaUrl';

/**
 * Phase 5-8 — Range-aware response builder for the `media://` protocol.
 *
 * Background: Phase 5-6.1 wired `protocol.handle('media', net.fetch(...))`
 * which returned the entire file as a single 200 body. Chromium's video
 * decoder needs HTTP-style Range support to scrub / decode progressive
 * MP4 — without it the `<video>` element sits on `readyState=0` forever
 * (the "영상 로딩 중..." hang the user reported).
 *
 * This handler:
 *   - Parses `Range: bytes=START-END` (either endpoint optional).
 *   - Streams the requested byte slice via `fs.createReadStream` so we
 *     never buffer the whole file into JS land.
 *   - Returns 206 Partial Content with Content-Range / Content-Length /
 *     Accept-Ranges / Content-Type that the video decoder expects.
 *   - Falls back to 200 + Accept-Ranges when no Range header was sent
 *     (e.g. the very first metadata probe; the decoder typically
 *     re-requests with Range once it learns the file is seekable).
 *
 * MIME mapping reuses the same guessMime as the DataURL fallback so an
 * `.mp4` shows up as `video/mp4`, `.gif` as `image/gif`, etc. Without
 * the right MIME Chromium falls back to a generic decoder that doesn't
 * understand the seek extents.
 */
export interface MediaProtocolResponseInit {
  status: number;
  headers: Record<string, string>;
  bodyStream: NodeJS.ReadableStream;
}

/** Pure planner — used by tests to verify Range parsing without ipc. */
export interface MediaResponsePlan {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  /** Byte slice to stream from the file. `null` means "whole file". */
  range: { start: number; end: number } | null;
}

export function planMediaResponse(
  size: number,
  ext: string,
  rangeHeader: string | null,
): MediaResponsePlan {
  const mime = guessMime(ext.toLowerCase());
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (m) {
      const hasStart = m[1] !== '';
      const hasEnd = m[2] !== '';
      let start: number;
      let end: number;
      if (hasStart) {
        start = parseInt(m[1], 10);
        end = hasEnd ? parseInt(m[2], 10) : size - 1;
      } else if (hasEnd) {
        // "bytes=-N" means the last N bytes.
        const last = parseInt(m[2], 10);
        start = Math.max(0, size - last);
        end = size - 1;
      } else {
        start = 0;
        end = size - 1;
      }
      if (start > end || start >= size) {
        return {
          status: 416,
          headers: {
            'Content-Type': mime,
            'Content-Range': `bytes */${size}`,
            'Accept-Ranges': 'bytes',
          },
          range: null,
        };
      }
      end = Math.min(end, size - 1);
      const length = end - start + 1;
      return {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
        range: { start, end },
      };
    }
  }
  return {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    },
    range: null,
  };
}

/**
 * Hard cap on a single Range response served as a single Buffer.
 *
 * Chromium asks for ranges of ~32KB-1MB during MP4 playback and the
 * audio element typically slurps the whole file in one go (only a few
 * MB). The buffered path is fast and avoids the stream cancellation
 * race that triggered ERR_UNEXPECTED. For anything bigger than this
 * cap (e.g. a hypothetical request for an entire 200 MB movie in one
 * shot, which Chromium does NOT do for media playback in practice) we
 * fall back to the streaming path. The cap is conservative — most
 * media playback paths never get near it.
 */
const BUFFER_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Handle one media:// request. Returns a web Response the protocol
 * handler can return verbatim from `protocol.handle`.
 *
 * Phase 5-8.4 — switched from Readable.toWeb-wrapped createReadStream
 * to a buffered fd.read for the common-case range. Symptom this fixes:
 *
 *   Failed to load resource: media:///var/folders/.../converted.mp4
 *   net::ERR_UNEXPECTED
 *   MEDIA_ELEMENT_ERROR: Format error
 *
 * Even though the file on disk WAS a valid h264 / yuv420p / faststart
 * MP4 produced by ffmpeg, Chromium's networking stack rejected the
 * Response object. Electron's protocol.handle consuming a ReadableStream
 * backed by a Node Readable has documented race conditions during
 * cancellation (Chromium aggressively cancels media range requests to
 * seek; if our stream's cancel callback doesn't fully shut down the
 * underlying read, the next request inherits a bad state). Same code
 * path served BOTH video and audio, so the same fix unblocks audio
 * preview too.
 *
 * Streaming is still available as a fallback for the rare > 64 MB
 * single-request case, but media playback ranges never approach that
 * size so the buffered path is what actually runs for users.
 */
export async function handleMediaRequest(request: Request): Promise<Response> {
  const fileUrl = mediaUrlToFileUrl(request.url);
  const filePath = fileURLToPath(fileUrl);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) {
    return new Response('Not found', { status: 404 });
  }
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  const plan = planMediaResponse(stat.size, ext, request.headers.get('range'));
  if (plan.status === 416) {
    return new Response(null, { status: 416, headers: plan.headers });
  }
  const start = plan.range?.start ?? 0;
  const length = plan.range
    ? plan.range.end - plan.range.start + 1
    : stat.size;

  // Buffered fast path — single fd.read into Buffer, then Response
  // wraps the byte array. No stream lifecycle.
  if (length <= BUFFER_RESPONSE_MAX_BYTES) {
    const fd = await fsOpen(filePath, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, start);
      const body = bytesRead === length ? buf : buf.subarray(0, bytesRead);
      // If the read came up short (file truncated mid-flight), update
      // Content-Length and Content-Range to match the bytes we actually
      // have — sending a Response whose Content-Length disagrees with
      // the body length is exactly what makes Chromium emit
      // ERR_UNEXPECTED.
      const headers = { ...plan.headers };
      if (bytesRead !== length) {
        headers['Content-Length'] = String(bytesRead);
        if (plan.range) {
          headers['Content-Range'] = `bytes ${plan.range.start}-${plan.range.start + bytesRead - 1}/${stat.size}`;
        }
      }
      return new Response(body, { status: plan.status, headers });
    } finally {
      await fd.close().catch(() => undefined);
    }
  }

  // Rare: caller asked for > 64 MB in one shot. Stream as a fallback,
  // but use a Buffer accumulator wrapped in a Response so we still
  // avoid the toWeb roundtrip. Concat once at the end and ship.
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const s = plan.range
      ? createReadStream(filePath, { start: plan.range.start, end: plan.range.end })
      : createReadStream(filePath);
    s.on('data', (c) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string)),
    );
    s.on('end', resolve);
    s.on('error', reject);
  });
  const full = Buffer.concat(chunks);
  return new Response(full, { status: plan.status, headers: plan.headers });
}
