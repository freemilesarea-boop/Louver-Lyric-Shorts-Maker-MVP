import { createReadStream, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
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
 * Handle one media:// request. Returns a web Response the protocol
 * handler can return verbatim from `protocol.handle`.
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
  const stream = plan.range
    ? createReadStream(filePath, { start: plan.range.start, end: plan.range.end })
    : createReadStream(filePath);
  // Node's Readable.toWeb produces a ReadableStream that Electron's
  // Response constructor accepts directly. Cast through `unknown`
  // because the lib.dom types don't know about the Node-web interop.
  const webBody = Readable.toWeb(stream) as unknown as ReadableStream;
  return new Response(webBody, {
    status: plan.status,
    headers: plan.headers,
  });
}
