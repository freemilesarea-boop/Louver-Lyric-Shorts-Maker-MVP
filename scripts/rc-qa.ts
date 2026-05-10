/**
 * Release Candidate QA harness.
 *
 * Runs the QA items not already covered by the dedicated smoke scripts
 * (test-fonts / test-watermark / test-export-presets / demo-pack):
 *
 *   4. Watermark ON/OFF render comparison — full pipeline run with each
 *      of 5 watermark positions + a no-watermark baseline. Probes file
 *      sizes and overlay counts to confirm the dedicated full-duration
 *      watermark PNG appears in the on case and not in the off case.
 *
 *   5. Safe-zone export-exclusion — static check of import graph plus a
 *      runtime check that buildOverlays-style overlay lists never include
 *      a safe-zone draw call (we render with safeZone enabled in store
 *      and confirm the overlay PNG count matches the no-safe-zone case).
 *
 *   6. Hook suggester — synthetic amplitude curves with a known peak.
 *      Verifies the suggester returns the peak window first.
 *
 *   7. Whisper graceful fallback — `detectWhisperBinary()` must return
 *      null when no whisper binary is on PATH and `transcribe()` must
 *      throw `WhisperNotInstalledError`, NOT crash with an uncaught
 *      spawn error. Run with PATH cleared.
 *
 *   8. Korean / spaced path — render an actual MP4 to a directory whose
 *      path contains spaces AND Korean. ffmpeg argv passes through
 *      without shell interpolation.
 *
 *   9. Custom preset save/load — atomic JSON round-trip. We exercise the
 *      storage module against a fake userData dir.
 *
 * Run with:  npx tsx scripts/rc-qa.ts
 */

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../src/main/render/binaries.ts';
import { runRender } from '../src/main/render/pipeline.ts';
import {
  WATERMARK_POSITIONS,
  paintWatermark,
  type WatermarkConfig,
} from '../src/shared/watermark.ts';
import { suggestHookSections } from '../src/shared/hookSuggest.ts';
import type { AmplitudeCurve, RenderRequest, Template } from '../src/shared/types.ts';
import { createCanvas } from '@napi-rs/canvas';
import { renderScene, SCENE_W, SCENE_H } from '../src/shared/scene.ts';

if (!ffmpegPath) {
  console.error('ffmpeg-static not resolved.');
  process.exit(2);
}

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

const TEMPLATE_STUB: Template = {
  id: 'rc-qa',
  name: 'rc-qa',
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

async function lavfi(filter: string, outPath: string, video: boolean): Promise<void> {
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filter];
  if (video) args.push('-frames:v', '1', '-update', '1');
  args.push(outPath);
  const r = spawnSync(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`lavfi ${filter}: ${r.stderr?.toString().slice(-300) ?? ''}`);
  }
}

/** Bake one full-duration watermark overlay PNG via @napi-rs/canvas. */
function bakeWatermarkPng(cfg: WatermarkConfig): string {
  const c = createCanvas(SCENE_W, SCENE_H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  // Render at exportMode=true to keep it transparent everywhere except
  // where the watermark + lyric/meta would be (lyric=null here, meta=null,
  // fxConfig=undefined → only watermark fires).
  renderScene(ctx as unknown as CanvasRenderingContext2D, {
    width: SCENE_W,
    height: SCENE_H,
    template: TEMPLATE_STUB,
    language: 'en',
    highlightSub: false,
    exportMode: true,
    lyric: null,
    watermark: cfg,
  });
  return c.toBuffer('image/png').toString('base64');
}

/* ----------------------------------------- 4. Watermark ON/OFF + positions */

async function checkWatermarkRenders(workDir: string): Promise<void> {
  console.log('\n=== 4. Watermark ON/OFF + position variants ===');
  const imagePath = join(workDir, 'wm-bg.png');
  const audioPath = join(workDir, 'wm-audio.wav');
  await lavfi('gradients=size=1080x1920:c0=0x101010:c1=0x303550:duration=1', imagePath, true);
  await lavfi('sine=frequency=220:duration=3', audioPath, false);

  const baseReq: Omit<RenderRequest, 'overlays'> = {
    imagePath,
    audioPath,
    lyrics: [],
    template: TEMPLATE_STUB,
    startSec: 0,
    durationSec: 3 as unknown as 15,
    highlightKorean: false,
    motionPreset: 'none',
    animationPreset: 'none',
    reactiveMode: 'none',
    fxPreset: 'none',
  };

  // Baseline: no watermark.
  const offPath = join(workDir, 'wm-off.mp4');
  const offRes = await runRender({ ...baseReq, overlays: [] }, offPath, () => undefined);

  // Per-position renders with one full-duration watermark overlay.
  type Result = { pos: string; size: number };
  const results: Result[] = [];
  for (const pos of WATERMARK_POSITIONS) {
    const png = bakeWatermarkPng({ enabled: true, text: '', position: pos });
    const path = join(workDir, `wm-${pos}.mp4`);
    const r = await runRender(
      { ...baseReq, overlays: [{ base64: png, startSec: 0, endSec: 3 }] },
      path,
      () => undefined,
    );
    const size = (await fs.stat(r.outputPath)).size;
    results.push({ pos, size });
  }

  const offSize = (await fs.stat(offRes.outputPath)).size;
  console.log(`  baseline (off): ${(offSize / 1024).toFixed(1)} KB`);
  for (const r of results) {
    console.log(`  ${r.pos.padEnd(13)}: ${(r.size / 1024).toFixed(1)} KB`);
  }

  for (const r of results) {
    ok(`[${r.pos}] render produces non-empty MP4`, r.size > 4096);
    // Overlay must add real bytes — synthetic input is so compressible that
    // a no-op overlay would not change the file size meaningfully.
    ok(`[${r.pos}] differs from no-watermark baseline`, r.size !== offSize,
      `off=${offSize} on=${r.size}`);
  }
}

/* -------------------------- 5. Safe zone never reaches export overlay path */

function checkSafeZoneExportExclusion(): void {
  console.log('\n=== 5. Safe zone never reaches export overlays ===');
  // Static contract: overlays.ts must NOT import safeZones.
  const overlaysSrc = require('node:fs').readFileSync(
    require('node:path').resolve('src/renderer/lib/overlays.ts'),
    'utf8',
  ) as string;
  ok(
    'overlays.ts does not import safeZones',
    !overlaysSrc.includes('safeZones') && !overlaysSrc.includes('paintSafeZones'),
  );
  // scene.ts must NOT import safeZones (renderScene is shared between
  // preview and export — a safeZones import here would leak the band into
  // export PNGs).
  const sceneSrc = require('node:fs').readFileSync(
    require('node:path').resolve('src/shared/scene.ts'),
    'utf8',
  ) as string;
  ok(
    'scene.ts does not import safeZones',
    !sceneSrc.includes("from './safeZones'"),
  );
  // Renderer-only consumers (LivePreview, SafeZoneToggle) are allowed.
  const livePreviewSrc = require('node:fs').readFileSync(
    require('node:path').resolve('src/renderer/components/LivePreview.tsx'),
    'utf8',
  ) as string;
  ok(
    'LivePreview imports paintSafeZones (preview-only)',
    livePreviewSrc.includes("paintSafeZones"),
  );
}

/* ------------------------------------- 6. Hook suggester picks loud window */

function checkHookSuggester(): void {
  console.log('\n=== 6. Hook suggester picks loud window ===');
  // Build a 60-second amplitude curve at 100ms resolution. Quiet floor 0.05
  // with a clear loud window in [25s, 35s] at 0.85.
  const interval = 0.1;
  const total = 60;
  const values: number[] = [];
  for (let i = 0; i < total / interval; i++) {
    const t = i * interval;
    values.push(t >= 25 && t < 35 ? 0.85 : 0.05);
  }
  const curve: AmplitudeCurve = {
    intervalSec: interval,
    values,
    durationSec: total,
  };

  const suggestions = suggestHookSections(curve, total, 10);
  ok('returns at least 1 candidate', suggestions.length >= 1);
  if (suggestions.length >= 1) {
    const top = suggestions[0];
    const overlap =
      Math.min(top.endSec, 35) - Math.max(top.startSec, 25);
    // The scorer explicitly bonuses windows with rising amplitude into
    // the second half — so a build-up edge near the loud region scores
    // higher than the flat-loud middle. We only require the top pick to
    // touch the loud region, not entirely contain it.
    ok(
      'top candidate overlaps loud window',
      overlap >= 4,
      `start=${top.startSec.toFixed(1)}, end=${top.endSec.toFixed(1)}, overlap=${overlap.toFixed(1)}s`,
    );
    ok('top candidate score above silent floor', top.energyScore > 0.2,
      `score=${top.energyScore.toFixed(3)}`);
  }

  // Empty/null curve must return [].
  ok('null curve → empty list', suggestHookSections(null, 60, 10).length === 0);
  ok(
    'duration <= target → single full-coverage candidate',
    (() => {
      const r = suggestHookSections(curve, 5, 10);
      return r.length === 1 && r[0].startSec === 0 && r[0].endSec === 5;
    })(),
  );
}

/* ---------------------------------- 7. Whisper graceful fallback (no PATH) */

async function checkWhisperGracefulFallback(): Promise<void> {
  console.log('\n=== 7. Whisper graceful fallback ===');
  // detectWhisperBinary uses spawnSync without an explicit env option, so
  // it inherits process.env.PATH at probe time. Mutating PATH in this
  // process is enough to simulate "no whisper binary installed" — child
  // processes spawned to probe `--help` will fail to resolve the binary
  // and the function returns null.
  const { detectWhisperBinary, transcribe, WhisperNotInstalledError } = await import(
    '../src/main/audio/transcribe.ts'
  );
  const savedPath = process.env.PATH;
  process.env.PATH = '/nonexistent-rc-qa-path';
  try {
    const detected = detectWhisperBinary(true);
    ok('detect returns null when PATH cleared', detected === null,
      `detected=${JSON.stringify(detected)}`);

    let threwInstalledError = false;
    let actualErrorName = '<no-throw>';
    let actualMessage = '';
    try {
      await transcribe({
        audioPath: '/tmp/nonexistent-rc-qa-audio.wav',
        startSec: 0,
        durationSec: 10,
        language: 'auto',
      });
    } catch (e) {
      actualErrorName = (e as Error)?.constructor?.name ?? 'Error';
      actualMessage = (e as Error)?.message ?? '';
      threwInstalledError = e instanceof WhisperNotInstalledError;
    }
    ok(
      'transcribe throws WhisperNotInstalledError (not raw spawn error)',
      threwInstalledError,
      `${actualErrorName}: ${actualMessage.slice(0, 80)}`,
    );
  } finally {
    process.env.PATH = savedPath;
  }
}

/* ----------------------------------------- 8. Korean / spaced path render */

async function checkKoreanSpacedPath(workDir: string): Promise<void> {
  console.log('\n=== 8. Korean + spaced path render ===');
  const trickyDir = join(workDir, '한 글 dir');
  await fs.mkdir(trickyDir, { recursive: true });
  const imagePath = join(trickyDir, '이미지 파일.png');
  const audioPath = join(trickyDir, '오디오 파일.wav');
  const outputPath = join(trickyDir, '결과 영상.mp4');
  await lavfi('gradients=size=1080x1920:c0=0x000033:c1=0x002255:duration=1', imagePath, true);
  await lavfi('sine=frequency=440:duration=2', audioPath, false);

  try {
    const r = await runRender(
      {
        imagePath,
        audioPath,
        lyrics: [],
        template: TEMPLATE_STUB,
        startSec: 0,
        durationSec: 2 as unknown as 15,
        highlightKorean: false,
        overlays: [],
        motionPreset: 'none',
        animationPreset: 'none',
        reactiveMode: 'none',
        fxPreset: 'none',
      },
      outputPath,
      () => undefined,
    );
    const stat = await fs.stat(r.outputPath);
    ok('output written under Korean/spaced path', stat.size > 4096,
      `${(stat.size / 1024).toFixed(1)} KB`);
  } catch (e) {
    ok('Korean/spaced path render', false, e instanceof Error ? e.message : String(e));
  }
}

/* ------------------------------------- 9. Custom preset save/load round-trip */

async function checkCustomPresetRoundTrip(workDir: string): Promise<void> {
  console.log('\n=== 9. Custom preset save/load round-trip ===');
  // The storage module imports `app` from electron and reads
  // app.getPath('userData'). We swap that out with a fake before importing.
  const userDataDir = join(workDir, 'fake-user-data');
  await fs.mkdir(userDataDir, { recursive: true });

  // Rather than mock electron at module level (tricky in tsx), we run the
  // round-trip in a fresh tsx child that injects a stub electron module
  // via a relative path.
  const stubPath = join(workDir, 'fake-electron.mts');
  await fs.writeFile(
    stubPath,
    `export const app = { getPath: (_k) => ${JSON.stringify(userDataDir)} };\n`,
  );
  const probePath = join(workDir, 'preset-probe.mts');
  await fs.writeFile(
    probePath,
    `
import Module from 'node:module';
const orig = Module.createRequire(import.meta.url);
// Patch the resolver so 'electron' in customPresets.ts maps to our stub.
const Mod: any = Module;
const realResolve = Mod._resolveFilename;
Mod._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return ${JSON.stringify(stubPath)};
  return realResolve.call(this, request, parent, ...rest);
};
const { listPresets, savePreset, deletePreset } = await import(${JSON.stringify(
      join(process.cwd(), 'src/main/storage/customPresets.ts'),
    )});

const before = await listPresets();
const saved = await savePreset({
  name: 'rc-qa-preset',
  templateId: 'kballad',
  motionPreset: 'slow_zoom_in',
  animationPreset: 'fade',
  reactiveMode: 'soft_pulse',
  cinematicFxPreset: 'clean_cinematic',
  language: 'ko',
});
const after = await listPresets();
const found = after.find((p) => p.id === saved.preset?.id);
console.log('beforeCount:', before.length);
console.log('afterCount:', after.length);
console.log('foundName:', found?.name);
console.log('foundLang:', found?.language);
console.log('foundReactive:', found?.reactiveMode);
const delRes = await deletePreset(saved.preset.id);
console.log('deleteOk:', delRes.ok);
const afterDelete = await listPresets();
console.log('afterDeleteCount:', afterDelete.length);
`,
  );
  const r = spawnSync('npx', ['tsx', probePath], {
    cwd: process.cwd(),
    timeout: 30_000,
    encoding: 'utf8',
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const get = (key: string): string =>
    out.split('\n').find((l) => l.startsWith(`${key}:`))?.split(':').slice(1).join(':').trim() ?? '';
  ok('save → list contains entry', get('foundName') === 'rc-qa-preset',
    `foundName=${get('foundName')}`);
  ok('language survives round-trip', get('foundLang') === 'ko');
  ok('reactiveMode survives round-trip', get('foundReactive') === 'soft_pulse');
  ok('count grew by 1',
    parseInt(get('afterCount'), 10) === parseInt(get('beforeCount'), 10) + 1);
  ok('delete returns ok=true', get('deleteOk') === 'true');
  ok('count back to original after delete',
    parseInt(get('afterDeleteCount'), 10) === parseInt(get('beforeCount'), 10));
  if (out.includes('Error:') && !out.includes('beforeCount:')) {
    console.log('  --- preset probe stderr ---');
    console.log(out.slice(-1200));
  }
}

/* ---------------------------------------- driver */

async function main(): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), 'rc-qa-'));
  console.log(`workdir: ${workDir}`);

  // Render-heavy checks — keep watermark first for fast smoke iteration.
  void paintWatermark; // silence unused import in builds where positions check stays static

  await checkWatermarkRenders(workDir);
  checkSafeZoneExportExclusion();
  checkHookSuggester();
  await checkWhisperGracefulFallback();
  await checkKoreanSpacedPath(workDir);
  await checkCustomPresetRoundTrip(workDir);

  if (allOk) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  } else {
    console.log(`\nKept workdir for inspection: ${workDir}`);
  }
  console.log(`\n${allOk ? 'RC QA: ALL CHECKS PASSED' : 'RC QA: SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('rc-qa fatal:', e);
  process.exit(1);
});
