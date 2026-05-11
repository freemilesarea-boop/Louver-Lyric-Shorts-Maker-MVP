/**
 * Phase 5-8 — media:// protocol Range-request smoke.
 *
 * Pin the contract that the new fs.createReadStream-based protocol
 * handler returns exactly what an HTTP server would for the seek
 * patterns Chromium's video decoder uses:
 *
 *   1. No Range header → 200 + Accept-Ranges + Content-Length.
 *   2. `Range: bytes=0-`             → 206 + Content-Range: 0-(N-1)/N.
 *   3. `Range: bytes=10-19`          → 206 + correct 10-byte slice.
 *   4. `Range: bytes=-32`            → 206 + suffix slice (last 32 bytes).
 *   5. `Range: bytes=999999-`        → 416 Range Not Satisfiable.
 *   6. Mime type correctness         → mp4 → video/mp4, gif → image/gif,
 *                                       png → image/png, mp3 → audio/mpeg.
 *
 * No Electron — `planMediaResponse` is the pure helper inside
 * mediaProtocol.ts. `handleMediaRequest` (the actual fetch handler) is
 * also exercised against fake files on disk to confirm the streamed
 * body bytes match the requested slice.
 *
 * Run:  npx tsx scripts/test-media-protocol.ts
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToMediaUrl } from '../src/main/ipc/mediaUrl';
import {
  handleMediaRequest,
  planMediaResponse,
} from '../src/main/ipc/mediaProtocol';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

async function main(): Promise<void> {
  const work = await fs.mkdtemp(join(tmpdir(), 'media-protocol-smoke-'));
  try {
    // === Pure planner contract =====================================
    // 100-byte file, no Range header → full body.
    const p0 = planMediaResponse(100, 'mp4', null);
    ok('no Range → status 200', p0.status === 200);
    ok('no Range → Accept-Ranges advertised', p0.headers['Accept-Ranges'] === 'bytes');
    ok('no Range → Content-Length matches size', p0.headers['Content-Length'] === '100');
    ok(
      'mp4 ext → video/mp4 mime',
      p0.headers['Content-Type'] === 'video/mp4',
    );

    // bytes=0- → full slice, but 206 (decoder asked for it).
    const p1 = planMediaResponse(100, 'mp4', 'bytes=0-');
    ok('bytes=0- → status 206', p1.status === 206);
    ok(
      'bytes=0- → Content-Range 0-99/100',
      p1.headers['Content-Range'] === 'bytes 0-99/100',
    );
    ok('bytes=0- → Content-Length 100', p1.headers['Content-Length'] === '100');

    // bytes=10-19 → middle slice.
    const p2 = planMediaResponse(100, 'mp4', 'bytes=10-19');
    ok('bytes=10-19 → status 206', p2.status === 206);
    ok(
      'bytes=10-19 → Content-Range 10-19/100',
      p2.headers['Content-Range'] === 'bytes 10-19/100',
    );
    ok('bytes=10-19 → Content-Length 10', p2.headers['Content-Length'] === '10');
    ok(
      'bytes=10-19 → range start/end',
      p2.range?.start === 10 && p2.range?.end === 19,
    );

    // bytes=-32 → suffix slice of last 32 bytes (68..99).
    const p3 = planMediaResponse(100, 'mp4', 'bytes=-32');
    ok('bytes=-32 → status 206', p3.status === 206);
    ok(
      'bytes=-32 → Content-Range 68-99/100',
      p3.headers['Content-Range'] === 'bytes 68-99/100',
    );
    ok(
      'bytes=-32 → range start/end',
      p3.range?.start === 68 && p3.range?.end === 99,
    );

    // bytes=999999- → unsatisfiable.
    const p4 = planMediaResponse(100, 'mp4', 'bytes=999999-');
    ok('bytes=999999- → 416 Range Not Satisfiable', p4.status === 416);
    ok(
      'bytes=999999- → Content-Range bytes */100',
      p4.headers['Content-Range'] === 'bytes */100',
    );

    // Mime mapping for the kinds the renderer actually loads.
    ok(
      'gif → image/gif',
      planMediaResponse(10, 'gif', null).headers['Content-Type'] === 'image/gif',
    );
    ok(
      'png → image/png',
      planMediaResponse(10, 'png', null).headers['Content-Type'] === 'image/png',
    );
    ok(
      'mp3 → audio/mpeg',
      planMediaResponse(10, 'mp3', null).headers['Content-Type'] === 'audio/mpeg',
    );
    ok(
      'webm → video/webm',
      planMediaResponse(10, 'webm', null).headers['Content-Type'] === 'video/webm',
    );

    // === End-to-end against a real file ============================
    // 1 KB of recognizable bytes (byte N === N mod 256).
    const fixture = join(work, 'fixture.mp4');
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
    await fs.writeFile(fixture, buf);
    const url = pathToMediaUrl(fixture);

    // Full read.
    const respFull = await handleMediaRequest(new Request(url));
    const bodyFull = Buffer.from(await respFull.arrayBuffer());
    ok('handleMediaRequest 200 status', respFull.status === 200);
    ok(
      'handleMediaRequest full body length',
      bodyFull.length === 1024,
      `len=${bodyFull.length}`,
    );
    ok(
      'handleMediaRequest full body content matches',
      bodyFull.equals(buf),
    );

    // Mid-slice read.
    const respMid = await handleMediaRequest(
      new Request(url, { headers: { Range: 'bytes=100-199' } }),
    );
    ok('handleMediaRequest mid slice 206 status', respMid.status === 206);
    const bodyMid = Buffer.from(await respMid.arrayBuffer());
    ok('handleMediaRequest mid slice length 100', bodyMid.length === 100);
    ok(
      'handleMediaRequest mid slice content matches',
      bodyMid.equals(buf.slice(100, 200)),
    );
    ok(
      'handleMediaRequest mid slice Content-Range header',
      respMid.headers.get('Content-Range') === 'bytes 100-199/1024',
    );

    // Suffix read.
    const respTail = await handleMediaRequest(
      new Request(url, { headers: { Range: 'bytes=-50' } }),
    );
    const bodyTail = Buffer.from(await respTail.arrayBuffer());
    ok('handleMediaRequest suffix 206 status', respTail.status === 206);
    ok('handleMediaRequest suffix length 50', bodyTail.length === 50);
    ok(
      'handleMediaRequest suffix content matches',
      bodyTail.equals(buf.slice(buf.length - 50)),
    );

    // Spaced + Korean path round-trip.
    const dir = join(work, 'spa ced 한글');
    await fs.mkdir(dir, { recursive: true });
    const spaced = join(dir, 'fixture mp4.mp4');
    await fs.writeFile(spaced, buf);
    const respSpaced = await handleMediaRequest(
      new Request(pathToMediaUrl(spaced), { headers: { Range: 'bytes=0-9' } }),
    );
    const bodySpaced = Buffer.from(await respSpaced.arrayBuffer());
    ok(
      'spaced+unicode path served correctly',
      respSpaced.status === 206 && bodySpaced.length === 10 && bodySpaced.equals(buf.slice(0, 10)),
    );

    // Missing file → 404.
    const respMissing = await handleMediaRequest(
      new Request(pathToMediaUrl(join(work, 'does-not-exist.mp4'))),
    );
    ok('missing file → 404', respMissing.status === 404);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${allOk ? 'MEDIA PROTOCOL OK' : 'MEDIA PROTOCOL BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
