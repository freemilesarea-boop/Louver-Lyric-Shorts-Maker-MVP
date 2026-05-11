/**
 * Phase 5-7 verification — display toggles + amplitude-driven waveform.
 *
 * Pins the contract that:
 *
 *   1. resolveDisplay() respects user overrides on top of the template
 *      defaults (showWaveform / showPlayerChrome flow through cleanly).
 *   2. buildFilterGraph() emits time-sliced drawbox blocks whose heights
 *      actually differ between loud and quiet stretches when an
 *      amplitudeCurve is supplied.
 *   3. buildFilterGraph() falls back to the legacy static-sin variant
 *      when the per-slice budget would exceed WAVEFORM_DRAWBOX_CAP.
 *   4. buildFilterGraph() honours showWaveform=false (override) by
 *      emitting zero waveform drawboxes.
 *   5. Same for showPlayerChrome=false → no progress/chrome drawboxes.
 *
 * No ffmpeg invocation — these are pure shape assertions on the filter
 * graph string. Render-level coverage stays in test:progress-motion and
 * test:rc-qa.
 *
 * Run:  npx tsx scripts/test-display-toggles.ts
 */

import {
  buildFilterGraph,
  WAVEFORM_BARS,
  WAVEFORM_DRAWBOX_CAP,
  WAVEFORM_EXPORT_FPS,
} from '../src/main/render/filters';
import { resolveDisplay } from '../src/shared/scene';
import type {
  AmplitudeCurve,
  StyleOverrides,
  Template,
} from '../src/shared/types';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

// Minimal Template stub — only the fields buildFilterGraph reads.
function mkTemplate(over: Partial<Template> = {}): Template {
  return {
    id: 'test-tpl',
    name: 'test',
    cardBg: '#000000',
    photoFrameBgColor: '#222222',
    backgroundEffect: 'blur',
    overlayOpacity: 0.4,
    framePadding: 0.04,
    frameStyle: 'soft',
    frameColor: '#FFFFFF',
    glowColor: '#88AAFF',
    lyricColor: '#FFFFFF',
    lyricSubColor: '#FFAA88',
    lyricPosition: 'bottom',
    showWaveform: true,
    progressBarStyle: 'thin',
    showPlayerControl: false,
    motionPreset: 'none',
    animationPreset: 'none',
    reactiveMode: 'none',
    cinematicFxPreset: 'none',
    ...over,
  } as Template;
}

function countWaveformBoxes(filter: string): number {
  // Each waveform drawbox produces an output label like `[wf0_3]` (sliced)
  // or `[wf3]` (legacy). Counting label appearances double-counts because
  // each emitted label is also referenced as the next stage's input —
  // count drawbox LINES that emit a wf label instead. The `^...$` match
  // (with the m flag) bounds it to one statement per line.
  const lines = filter.split(/;\s*\n?/);
  return lines.filter((l) => /drawbox=.*\[wf\d+(?:_\d+)?\]\s*$/.test(l)).length;
}

function countProgressBoxes(filter: string): number {
  const lines = filter.split(/;\s*\n?/);
  return lines.filter((l) => /drawbox=.*\[pb\d+\]\s*$/.test(l)).length;
}

function mkCurve(values: number[], intervalSec = 0.1): AmplitudeCurve {
  return {
    intervalSec,
    values,
    durationSec: values.length * intervalSec,
  };
}

function main(): void {
  // === 1. resolveDisplay defaults + overrides ===
  const tpl = mkTemplate({
    showWaveform: true,
    progressBarStyle: 'thin',
    playerChrome: 'apple-like',
  });
  const d0 = resolveDisplay(tpl, null);
  ok('default → showWaveform follows template', d0.showWaveform === true);
  ok('default → showPlayerChrome reflects template chrome', d0.showPlayerChrome === true);

  const d1 = resolveDisplay(tpl, { showWaveform: false });
  ok('override showWaveform=false hides waveform', d1.showWaveform === false);
  ok(
    'override showWaveform doesn\'t touch chrome',
    d1.showPlayerChrome === true,
  );

  const d2 = resolveDisplay(tpl, { showPlayerChrome: false });
  ok('override showPlayerChrome=false hides chrome', d2.showPlayerChrome === false);
  ok('override showPlayerChrome=false also hides progress bar', d2.showProgressBar === false);

  const d3 = resolveDisplay(
    mkTemplate({ showWaveform: false, progressBarStyle: 'none', playerChrome: undefined }),
    { showWaveform: true, showPlayerChrome: true },
  );
  ok(
    'forcing show on a chrome-less template still hides chrome (no painter)',
    d3.showPlayerChrome === false,
  );
  ok('forcing waveform on works regardless of template default', d3.showWaveform === true);

  // === 2. Amplitude curve drives bar heights ===
  // Quiet first half (0.05) + loud second half (0.85). At 8fps over 4s
  // we get 32 slices total — well below cap. Sample two opposite-end
  // slices and assert their drawbox heights actually differ.
  const quietLoud = mkCurve(
    [...Array(20).fill(0.05), ...Array(20).fill(0.85)],
    0.1,
  );
  const filterAmp = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 4,
    template: tpl,
    overlays: [],
    motionPreset: 'none',
    amplitudeCurve: quietLoud,
  });
  const wfCount = countWaveformBoxes(filterAmp);
  const expectedSlices = Math.ceil(4 * WAVEFORM_EXPORT_FPS);
  ok(
    'amplitude path emits bars × slices drawboxes',
    wfCount === WAVEFORM_BARS * expectedSlices,
    `got=${wfCount} expected=${WAVEFORM_BARS * expectedSlices}`,
  );

  // Pull bar 0 of the first slice and bar 0 of the last slice and
  // assert h= differs.
  const firstBar = filterAmp.match(/\[wf0_0\][\s\S]+?h=(\d+)/);
  const lastSliceIdx = expectedSlices - 1;
  const lastBarRe = new RegExp(`\\[wf${lastSliceIdx}_0\\][^\\n]+h=(\\d+)`);
  const lastBar = filterAmp.match(lastBarRe);
  ok('first slice bar height parsed', firstBar !== null);
  ok('last slice bar height parsed', lastBar !== null);
  if (firstBar && lastBar) {
    const h0 = parseInt(firstBar[1], 10);
    const hN = parseInt(lastBar[1], 10);
    ok(
      'loud slice produces taller bars than quiet slice',
      hN > h0,
      `quietH=${h0} loudH=${hN}`,
    );
  }

  // === 3. Cap fallback → static sin variant ===
  // Force a duration whose slice count would blow the cap. With 32
  // bars + 8fps we hit 12000 boxes at duration ≈ 47s. Use 90s to be
  // safely over.
  const filterCap = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 90,
    template: tpl,
    overlays: [],
    motionPreset: 'none',
    amplitudeCurve: mkCurve(Array(900).fill(0.5), 0.1),
  });
  const wfCountCap = countWaveformBoxes(filterCap);
  ok(
    'over-cap duration falls back to static sin (32 bars total)',
    wfCountCap === WAVEFORM_BARS,
    `got=${wfCountCap} cap=${WAVEFORM_DRAWBOX_CAP}`,
  );
  ok(
    'cap fallback uses static sin expression',
    /sin\(t\*3/.test(filterCap),
  );

  // === 4. showWaveform override hides waveform in export ===
  const filterNoWave = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 6,
    template: tpl,
    overlays: [],
    motionPreset: 'none',
    amplitudeCurve: quietLoud,
    styleOverrides: { showWaveform: false },
  });
  ok(
    'showWaveform=false → no waveform drawboxes',
    countWaveformBoxes(filterNoWave) === 0,
  );

  // === 5. showPlayerChrome override hides progress bar in export ===
  const tplWithProgress = mkTemplate({
    showWaveform: false,
    progressBarStyle: 'thin',
    playerChrome: undefined,
  });
  const filterWithProgress = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 6,
    template: tplWithProgress,
    overlays: [],
    motionPreset: 'none',
  });
  ok(
    'progress bar present by default',
    countProgressBoxes(filterWithProgress) > 0,
  );

  const filterNoChrome = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 6,
    template: tplWithProgress,
    overlays: [],
    motionPreset: 'none',
    styleOverrides: { showPlayerChrome: false },
  });
  ok(
    'showPlayerChrome=false → no progress drawboxes',
    countProgressBoxes(filterNoChrome) === 0,
  );

  console.log(`\n${allOk ? 'DISPLAY TOGGLES + AMPLITUDE WAVEFORM OK' : 'DISPLAY TOGGLES BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main();
