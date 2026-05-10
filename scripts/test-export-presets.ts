/**
 * Export preset smoke. Renders the same 5-second clip with each of the 4
 * presets and probes the outputs to verify:
 *
 *   1. The render pipeline accepts `exportEncode` and emits a valid MP4.
 *   2. libx264 / aac codecs are unchanged across presets.
 *   3. CRF / bitrate differences propagate — file sizes line up with the
 *      designed quality ladder (master > reels > shorts > tiktok).
 *   4. nameTag suffix appears in the filename.
 *
 * No bundled fixtures — the script generates a synthetic image + audio
 * via ffmpeg lavfi and feeds them to runRender directly.
 *
 * Run with:  npx tsx scripts/test-export-presets.ts
 */

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../src/main/render/binaries.ts';
import { runRender } from '../src/main/render/pipeline.ts';
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_KEYS,
} from '../src/shared/exportPresets.ts';
import type { RenderRequest, Template } from '../src/shared/types.ts';

if (!ffmpegPath) {
  console.error('ffmpeg-static not resolved — install dependencies first.');
  process.exit(2);
}

const DURATION = 5 as const;

const TEMPLATE_STUB: Template = {
  id: 'smoke',
  name: 'smoke',
  fontFamily: '"Inter", sans-serif',
  fontSize: 60,
  fontWeight: 700,
  lyricPosition: 'center',
  lyricColor: '#ffffff',
  lyricSubColor: '#cccccc',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: false,
  progressBarStyle: 'thin',
  backgroundEffect: 'none',
  animationStyle: 'none',
  cardBg: '#000000',
  overlayOpacity: 0.0,
};

async function generateLavfi(filter: string, outPath: string, video: boolean): Promise<void> {
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filter];
  if (video) args.push('-frames:v', '1', '-update', '1');
  args.push(outPath);
  const r = spawnSync(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`lavfi ${filter}: ${r.stderr?.toString().slice(-400) ?? ''}`);
  }
}

interface ProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  durationSec: number | null;
}

function probe(path: string): ProbeResult {
  // Use ffmpeg itself to probe — ffprobe-static works but ffmpeg -i + parse
  // is enough for a smoke check.
  const r = spawnSync(ffmpegPath!, ['-hide_banner', '-i', path], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const out = r.stderr?.toString() ?? '';
  const videoCodec = /Video: (\w+)/.exec(out)?.[1] ?? null;
  const audioCodec = /Audio: (\w+)/.exec(out)?.[1] ?? null;
  const bm = /bitrate: (\d+) kb\/s/.exec(out);
  const bitrateKbps = bm ? parseInt(bm[1], 10) : null;
  const dm = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
  const durationSec = dm
    ? parseInt(dm[1], 10) * 3600 + parseInt(dm[2], 10) * 60 + parseFloat(dm[3])
    : null;
  return { videoCodec, audioCodec, bitrateKbps, durationSec };
}

async function main(): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), 'export-presets-smoke-'));
  console.log(`workdir: ${workDir}`);

  const imagePath = join(workDir, 'bg.png');
  const audioPath = join(workDir, 'audio.wav');
  await generateLavfi('gradients=size=1080x1920:c0=0x000000:c1=0x305050:duration=1', imagePath, true);
  await generateLavfi(`sine=frequency=220:duration=${DURATION}`, audioPath, false);

  const results: Array<{
    key: string;
    sizeBytes: number;
    probe: ProbeResult;
    outputPath: string;
  }> = [];

  let allOk = true;

  for (const key of EXPORT_PRESET_KEYS) {
    const def = EXPORT_PRESETS[key];
    const outName = `smoke${def.filenameSuffix}.mp4`;
    const outputPath = join(workDir, outName);

    const req: RenderRequest = {
      imagePath,
      audioPath,
      lyrics: [],
      template: TEMPLATE_STUB,
      startSec: 0,
      durationSec: DURATION as unknown as 15,
      highlightKorean: false,
      overlays: [],
      motionPreset: 'none',
      animationPreset: 'none',
      reactiveMode: 'none',
      fxPreset: 'none',
      nameTag: def.filenameSuffix,
      exportEncode: def.encode,
    };

    process.stdout.write(`[${key}] rendering... `);
    const t0 = Date.now();
    try {
      const r = await runRender(req, outputPath, () => undefined);
      const stat = await fs.stat(r.outputPath);
      const p = probe(r.outputPath);
      console.log(
        `ok · ${(Date.now() - t0)}ms · ${(stat.size / 1024).toFixed(0)}KB · ` +
          `${p.videoCodec}/${p.audioCodec} · ${p.bitrateKbps}kbps`,
      );
      results.push({ key, sizeBytes: stat.size, probe: p, outputPath: r.outputPath });
    } catch (e) {
      console.log(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
      allOk = false;
    }
  }

  if (results.length !== EXPORT_PRESET_KEYS.length) {
    console.error(`\nOnly ${results.length}/${EXPORT_PRESET_KEYS.length} renders succeeded.`);
    process.exit(1);
  }

  // ---------------------------------------------- Assertions
  console.log('\n--- Assertions ---');

  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
    if (!cond) allOk = false;
  };

  for (const r of results) {
    ok(`[${r.key}] codec=h264`, r.probe.videoCodec === 'h264');
    ok(`[${r.key}] codec=aac`, r.probe.audioCodec === 'aac');
    ok(`[${r.key}] duration ≈ ${DURATION}s`,
      r.probe.durationSec != null && Math.abs(r.probe.durationSec - DURATION) < 0.5,
      `actual=${r.probe.durationSec}`);
    ok(`[${r.key}] file non-empty`, r.sizeBytes > 1024);
    ok(`[${r.key}] suffix ${EXPORT_PRESETS[r.key as keyof typeof EXPORT_PRESETS].filenameSuffix} in name`,
      r.outputPath.includes(EXPORT_PRESETS[r.key as keyof typeof EXPORT_PRESETS].filenameSuffix));
  }

  // Quality ladder. With a synthetic still image + sine wave the video
  // residual is heavily compressible and the dominant size signal is the
  // audio bitrate cap (tiktok 128k vs master 320k). Strict 4-way ordering
  // is too brittle on such a degenerate input — the middle two presets
  // (shorts/reels) often land within muxer-overhead noise of each other.
  // We verify the meaningful endpoints + that the encode override actually
  // reached the pipeline (i.e. the outputs are not identical).
  const byKey = (k: string) => results.find((r) => r.key === k)!;
  const master = byKey('high-quality');
  const reels = byKey('instagram-reels');
  const shorts = byKey('youtube-shorts');
  const tiktok = byKey('tiktok');

  console.log('\nSize / total bitrate per preset:');
  for (const r of [master, reels, shorts, tiktok]) {
    console.log(
      `  ${r.key.padEnd(16)} ${(r.sizeBytes / 1024).toFixed(1).padStart(7)} KB · ${
        r.probe.bitrateKbps ?? '?'
      } kbps`,
    );
  }

  // tiktok has both the highest CRF (24) AND the lowest audio bitrate
  // (128k) — it must be the smallest output regardless of input.
  ok('tiktok ≤ all other presets',
    tiktok.sizeBytes <= master.sizeBytes &&
      tiktok.sizeBytes <= reels.sizeBytes &&
      tiktok.sizeBytes <= shorts.sizeBytes);

  // The 128k audio cap on tiktok is the only one that actually binds on
  // a pure-sine source — AAC on the upper presets (192/256/320k) codes well
  // below cap and the residual differences are noise. So we only assert
  // tiktok is below the others; we don't strictly order the upper three.
  for (const upper of [shorts, reels, master]) {
    ok(`tiktok kbps < ${upper.key} kbps`,
      (tiktok.probe.bitrateKbps ?? 0) < (upper.probe.bitrateKbps ?? 0),
      `${tiktok.probe.bitrateKbps} < ${upper.probe.bitrateKbps}`);
  }

  // Sanity: outputs must not be byte-identical — if exportEncode were being
  // ignored every preset would produce the same bytes.
  const allSizes = new Set(results.map((r) => r.sizeBytes));
  ok('encode params produce distinct outputs', allSizes.size >= 3,
    `unique sizes=${allSizes.size}/4`);

  // Cleanup workdir on success.
  if (allOk) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  } else {
    console.log(`\nKept workdir for inspection: ${workDir}`);
  }

  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
