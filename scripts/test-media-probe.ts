/**
 * Phase 5-8.1 — codec / pixel-format validator smoke.
 *
 * Pins the contract that:
 *   1. probeMedia returns codec / pixel format / dimensions / duration
 *      / has-audio from a real ffprobe invocation on disk.
 *   2. isSupportedForPreview accepts h264 + yuv420p, rejects hevc and
 *      yuv420p10le with concrete reasons the user can act on.
 *   3. recommendedTranscodeArgs produces an argv that ffmpeg actually
 *      accepts AND that converts an HEVC source into a libx264 /
 *      yuv420p / no-audio MP4 — the exact shape Chromium's <video>
 *      will decode.
 *   4. parseProbe (pure) handles real ffprobe JSON without throwing.
 *
 * Run:  npx tsx scripts/test-media-probe.ts
 */

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  isSupportedForPreview,
  parseProbe,
  probeMedia,
  recommendedTranscodeArgs,
} from '../src/main/ipc/mediaProbe';
import { shouldShowConvert } from '../src/renderer/components/mediaValidationLogic';

const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';
const FFPROBE = (ffprobeStatic as { path?: string }).path || 'ffprobe';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

async function makeH264Mp4(out: string): Promise<void> {
  const r = await run(FFMPEG, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=10:duration=1',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    out,
  ]);
  if (r.code !== 0) throw new Error(`h264 fixture: ${r.out.slice(-400)}`);
}

async function makeHevcMp4(out: string): Promise<void> {
  // libx265 isn't always in static builds; check if available.
  const probe = await run(FFMPEG, ['-hide_banner', '-encoders']);
  if (!/libx265|hevc_/i.test(probe.out)) {
    // No HEVC encoder available — fall back to a 10-bit yuv420p10le
    // h264-like file via libx264 -profile high10. That's enough to
    // exercise the pixel-format rejection branch.
    const r = await run(FFMPEG, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=10:duration=1',
      '-pix_fmt', 'yuv420p10le',
      '-c:v', 'libx264',
      '-profile:v', 'high10',
      '-preset', 'ultrafast',
      out,
    ]);
    if (r.code !== 0) throw new Error(`10-bit h264 fixture: ${r.out.slice(-400)}`);
    return;
  }
  const r = await run(FFMPEG, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=10:duration=1',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx265',
    '-tag:v', 'hvc1',
    '-preset', 'ultrafast',
    out,
  ]);
  if (r.code !== 0) throw new Error(`hevc fixture: ${r.out.slice(-400)}`);
}

async function main(): Promise<void> {
  const work = await fs.mkdtemp(join(tmpdir(), 'media-probe-smoke-'));
  try {
    // === 1. Pure parser — handles synthetic ffprobe JSON ===
    const synth = JSON.stringify({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.5' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080,
          r_frame_rate: '30000/1001',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    const p0 = parseProbe(synth);
    ok('parseProbe → format short name', p0.format === 'mov');
    ok('parseProbe → h264 codec', p0.videoCodec === 'h264');
    ok('parseProbe → yuv420p pix_fmt', p0.pixelFormat === 'yuv420p');
    ok('parseProbe → duration 12.5', Math.abs(p0.durationSec - 12.5) < 0.01);
    ok('parseProbe → 1920x1080', p0.width === 1920 && p0.height === 1080);
    ok('parseProbe → 29.97 fps', Math.abs(p0.frameRate - 29.97) < 0.01);
    ok('parseProbe → hasAudio', p0.hasAudio);

    // === 2. Support classifier ===
    ok('h264 + yuv420p → supported', isSupportedForPreview(p0).supported);

    const hevc = parseProbe(
      JSON.stringify({
        format: { format_name: 'mov,mp4', duration: '5' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'hevc',
            pix_fmt: 'yuv420p',
            width: 1080,
            height: 1920,
            r_frame_rate: '30/1',
          },
        ],
      }),
    );
    const hevcVerdict = isSupportedForPreview(hevc);
    ok('hevc → unsupported', !hevcVerdict.supported);
    ok(
      'hevc → friendly reason names the codec',
      /hevc/i.test(hevcVerdict.reason),
      hevcVerdict.reason,
    );

    const tenBit = parseProbe(
      JSON.stringify({
        format: { format_name: 'mov,mp4', duration: '5' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            pix_fmt: 'yuv420p10le',
            width: 1080,
            height: 1920,
            r_frame_rate: '30/1',
          },
        ],
      }),
    );
    const tenBitVerdict = isSupportedForPreview(tenBit);
    ok('h264 + 10-bit → unsupported', !tenBitVerdict.supported);
    ok(
      '10-bit → friendly reason names the pixel format',
      /yuv420p10le/i.test(tenBitVerdict.reason),
      tenBitVerdict.reason,
    );

    const noStream = parseProbe(
      JSON.stringify({ format: { format_name: 'mp4', duration: '0' }, streams: [] }),
    );
    ok('zero-stream → unsupported', !isSupportedForPreview(noStream).supported);

    // === 3. End-to-end against real ffprobe ===
    const h264File = join(work, 'src-h264.mp4');
    await makeH264Mp4(h264File);
    const realH264 = await probeMedia(h264File, FFPROBE);
    ok(
      'probeMedia on real h264 → supported',
      isSupportedForPreview(realH264).supported,
      `codec=${realH264.videoCodec} pix=${realH264.pixelFormat}`,
    );

    const hevcFile = join(work, 'src-hevc.mp4');
    await makeHevcMp4(hevcFile);
    const realHevc = await probeMedia(hevcFile, FFPROBE);
    const realHevcVerdict = isSupportedForPreview(realHevc);
    ok(
      'probeMedia on real hevc/10-bit → unsupported',
      !realHevcVerdict.supported,
      `codec=${realHevc.videoCodec} pix=${realHevc.pixelFormat}`,
    );

    // === 4. Transcode argv actually produces a supported file ===
    const transcoded = join(work, 'transcoded.mp4');
    const args = recommendedTranscodeArgs(hevcFile, transcoded);
    ok('transcode argv ends in destPath', args[args.length - 1] === transcoded);
    ok('transcode argv drops audio (-an)', args.includes('-an'));
    ok('transcode argv forces yuv420p', args.includes('-pix_fmt') && args.includes('yuv420p'));

    const tr = await run(FFMPEG, args);
    ok('ffmpeg accepts transcode argv', tr.code === 0, `code=${tr.code}`);
    const transProbe = await probeMedia(transcoded, FFPROBE);
    ok(
      'transcoded file → h264',
      transProbe.videoCodec === 'h264',
      `codec=${transProbe.videoCodec}`,
    );
    ok(
      'transcoded file → yuv420p',
      transProbe.pixelFormat === 'yuv420p',
      `pix=${transProbe.pixelFormat}`,
    );
    ok(
      'transcoded file → no audio',
      !transProbe.hasAudio,
    );
    ok(
      'transcoded file → supported for preview',
      isSupportedForPreview(transProbe).supported,
    );

    // === 4b. Banner convert-button visibility — Phase 5-8.2 regression pin ===
    // User report: 1920x3414 h264/yuv420p file. ffprobe says supported,
    // Chromium runtime errors out. Previously the banner suppressed the
    // convert button because reply.supported was true. shouldShowConvert
    // now treats parent forceShow as authoritative.
    ok(
      'probe-says-unsupported + no force → button shown',
      shouldShowConvert({ probeSupported: false, forceShow: false }),
    );
    ok(
      'probe-says-supported + no force → button hidden (preview will work)',
      !shouldShowConvert({ probeSupported: true, forceShow: false }),
    );
    ok(
      'probe-says-supported + forceShow=true → button STILL shown (Chromium overrides probe)',
      shouldShowConvert({ probeSupported: true, forceShow: true }),
    );
    ok(
      'probe-pending + forceShow=true → button shown immediately',
      shouldShowConvert({ probeSupported: null, forceShow: true }),
    );
    ok(
      'probe-pending + no force → button hidden until probe resolves',
      !shouldShowConvert({ probeSupported: null, forceShow: false }),
    );

    // === 5. URL encoding handling (spaced + Korean + special chars) ===
    // Phase 5-8.1 user spec: "URL에 #, %, ?, 한글, 공백 포함된 파일
    // 테스트". We verify pathToMediaUrl + mediaUrlToFileUrl round-trip
    // for these — handled in test:media-loading already, but rerun
    // here so a regression in this script makes it obvious where the
    // breakage is.
    const { pathToMediaUrl, mediaUrlToFileUrl } = await import('../src/main/ipc/mediaUrl');
    const tricky = join(work, 'spa ced # ? 한글 100% .mp4');
    await fs.copyFile(h264File, tricky);
    const url = pathToMediaUrl(tricky);
    ok(
      'tricky path → media:// URL has encoded #/?/%/space',
      url.startsWith('media://') &&
        !url.includes(' ') &&
        url.includes('%20') &&
        url.includes('%23') /* # */ &&
        url.includes('%3F') /* ? */,
      `url=${url}`,
    );
    // file: roundtrip → fileURLToPath should give us back the exact path.
    const { fileURLToPath } = await import('node:url');
    const back = fileURLToPath(mediaUrlToFileUrl(url));
    ok('tricky path round-trips through media://', back === tricky, `back=${back}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${allOk ? 'MEDIA PROBE OK' : 'MEDIA PROBE BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
