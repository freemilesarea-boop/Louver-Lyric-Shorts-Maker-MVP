/**
 * Media loading regression smoke (Phase 5-6.1).
 *
 * Background: `files:readAsDataURL` used to base64-encode any path it
 * was handed. A 50MB MP4 produces a ~67MB base64 string; a 400MB MP4
 * blows past V8's max single-string size (0x1fffffe8 chars) and the
 * IPC throws "Cannot create a string longer than ...". This smoke
 * pins the new behavior:
 *
 *   - readImageAsDataURL refuses gif / mp4 / unknown extensions.
 *   - readImageAsDataURL refuses image files larger than 10MB.
 *   - readImageAsDataURL accepts small images and produces a
 *     `data:image/...;base64,` string with the correct mime.
 *   - pathToMediaUrl returns `media://` URLs that round-trip cleanly
 *     through mediaUrlToFileUrl.
 *   - pathToMediaUrl works on absolute paths with spaces and Unicode.
 *   - A 12MB fake mp4 written to disk does not even get read into
 *     memory (we sanity-check the refusal happens before any
 *     allocation).
 *
 * Run with:  npx tsx scripts/test-media-loading.ts
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  DataUrlRefusedError,
  DATAURL_MAX_BYTES,
  mediaUrlToFileUrl,
  pathToMediaUrl,
  readImageAsDataURL,
} from '../src/main/ipc/mediaUrl';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

async function expectRefused(path: string, label: string): Promise<void> {
  try {
    await readImageAsDataURL(path);
    ok(label, false, 'expected DataUrlRefusedError, got success');
  } catch (e) {
    ok(
      label,
      e instanceof DataUrlRefusedError,
      `errName=${e instanceof Error ? e.name : typeof e}`,
    );
  }
}

async function main(): Promise<void> {
  const work = await fs.mkdtemp(join(tmpdir(), 'media-loading-smoke-'));
  try {
    // === 1. readImageAsDataURL refuses non-image extensions ===
    const fakeMp4 = join(work, 'fake.mp4');
    await fs.writeFile(fakeMp4, Buffer.from([0x00, 0x00, 0x00, 0x18])); // tiny "moov-ish"
    await expectRefused(fakeMp4, 'mp4 → readAsDataURL throws DataUrlRefusedError');

    const fakeMov = join(work, 'fake.mov');
    await fs.writeFile(fakeMov, 'mov\n');
    await expectRefused(fakeMov, 'mov → readAsDataURL throws');

    const fakeWebm = join(work, 'fake.webm');
    await fs.writeFile(fakeWebm, 'webm\n');
    await expectRefused(fakeWebm, 'webm → readAsDataURL throws');

    const fakeGif = join(work, 'fake.gif');
    // Write a real-ish GIF89a header so any future "is it really a gif?"
    // check passes; we still expect the extension-based refusal.
    await fs.writeFile(
      fakeGif,
      Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00', 'binary'),
    );
    await expectRefused(fakeGif, 'gif → readAsDataURL throws');

    const noExt = join(work, 'no-extension-file');
    await fs.writeFile(noExt, 'whatever');
    await expectRefused(noExt, 'no-extension → readAsDataURL throws');

    // === 2. Size cap on images ===
    const bigPng = join(work, 'big.png');
    // Write 11MB of zeroes. Not a valid PNG but the size check fires
    // before any decoding — that's the contract we want to pin.
    const big = Buffer.alloc(11 * 1024 * 1024);
    await fs.writeFile(bigPng, big);
    await expectRefused(bigPng, '11MB png → readAsDataURL throws');

    // Validate the cap constant is what we documented.
    ok(
      'DATAURL_MAX_BYTES is 10MB',
      DATAURL_MAX_BYTES === 10 * 1024 * 1024,
      `got=${DATAURL_MAX_BYTES}`,
    );

    // === 3. Small image happy path ===
    const tinyPng = join(work, 'tiny.png');
    // 1x1 transparent PNG — actual valid bytes.
    const png1x1 = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000a49444154789c63000100000005000100' +
        '0d0a2db40000000049454e44ae426082',
      'hex',
    );
    await fs.writeFile(tinyPng, png1x1);
    const dataUrl = await readImageAsDataURL(tinyPng);
    ok(
      'tiny.png → data:image/png;base64,...',
      dataUrl.startsWith('data:image/png;base64,'),
      `prefix=${dataUrl.slice(0, 32)}`,
    );

    const tinyJpg = join(work, 'tiny.jpg');
    await fs.writeFile(tinyJpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const jpgUrl = await readImageAsDataURL(tinyJpg);
    ok(
      'tiny.jpg → data:image/jpeg;base64,...',
      jpgUrl.startsWith('data:image/jpeg;base64,'),
      `prefix=${jpgUrl.slice(0, 32)}`,
    );

    const tinyWebp = join(work, 'tiny.webp');
    await fs.writeFile(tinyWebp, 'RIFF\x00\x00\x00\x00WEBP');
    const webpUrl = await readImageAsDataURL(tinyWebp);
    ok(
      'tiny.webp → data:image/webp;base64,...',
      webpUrl.startsWith('data:image/webp;base64,'),
      `prefix=${webpUrl.slice(0, 32)}`,
    );

    // === 4. pathToMediaUrl shape ===
    const u = pathToMediaUrl(tinyPng);
    ok(
      'pathToMediaUrl returns media:// URL',
      u.startsWith('media://'),
      `url=${u}`,
    );

    // Round-trip: media → file → renormalize → strip 'file:' → original.
    const back = mediaUrlToFileUrl(u);
    ok(
      'mediaUrlToFileUrl swaps scheme back',
      back.startsWith('file://') && back === pathToFileURL(tinyPng).toString(),
      `back=${back}`,
    );

    // === 5. Spaces and Unicode in paths ===
    const spacedDir = join(work, 'spa ced 한글');
    await fs.mkdir(spacedDir, { recursive: true });
    const spacedPng = join(spacedDir, 'tiny image.png');
    await fs.writeFile(spacedPng, png1x1);
    const spacedUrl = pathToMediaUrl(spacedPng);
    ok(
      'spaced + Unicode path → media:// URL with proper encoding',
      spacedUrl.startsWith('media://') &&
        // pathToFileURL encodes spaces as %20, never raw spaces.
        !spacedUrl.includes(' '),
      `url=${spacedUrl}`,
    );
    const spacedBack = mediaUrlToFileUrl(spacedUrl);
    const spacedExpected = pathToFileURL(spacedPng).toString();
    ok(
      'spaced URL round-trips',
      spacedBack === spacedExpected,
      `back=${spacedBack}`,
    );

    // === 6. 12MB "video" never even gets read ===
    // We can't directly assert "no allocation" from outside, but we
    // can verify the size check rejects without trying to base64 — by
    // timing the call. A base64 of 12MB takes >100ms typically; the
    // refusal returns in microseconds. Use that as a sanity floor.
    const bigFakeMp4 = join(work, 'big-fake.mp4');
    await fs.writeFile(bigFakeMp4, Buffer.alloc(12 * 1024 * 1024));
    const t0 = performance.now();
    let threw = false;
    try {
      await readImageAsDataURL(bigFakeMp4);
    } catch {
      threw = true;
    }
    const dt = performance.now() - t0;
    ok(
      '12MB .mp4 is rejected fast (no base64 buffer allocated)',
      threw && dt < 50,
      `dtMs=${dt.toFixed(2)}`,
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${allOk ? 'MEDIA LOADING OK' : 'MEDIA LOADING BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
