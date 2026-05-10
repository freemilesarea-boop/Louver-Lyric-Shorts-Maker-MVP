/**
 * Production filter graph inspection. Builds the filter for each
 * shipped template and prints the per-line breakdown with annotations.
 * Used to verify §5 / §6.5 / §7 gates are correct without rendering an
 * actual video.
 *
 * Run: npx tsx scripts/test-filter-graph.ts
 */

import { buildFilterGraph } from '../src/main/render/filters.ts';
import { progressBarGeom } from '../src/shared/playerChrome.ts';
import { templates } from '../src/renderer/templates/templates.ts';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

console.log('--- Production filter graph audit ---');
for (const t of templates) {
  const filter = buildFilterGraph({
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 15,
    template: t,
    overlays: [],
    motionPreset: 'none',
    backgroundInputIndex: null,
    mainScale: 1,
    playerProgressGeom: progressBarGeom(t.playerChrome ?? null),
  });

  const hasDefaultProgress = /drawbox=x=80:y=1689/.test(filter);
  const hasChromeProgress = /\[pc_track\]/.test(filter);
  const hasWaveform = /drawbox=x=100:y='1610-/.test(filter);
  const hasTwo =
    hasDefaultProgress && hasChromeProgress;
  const expectsChrome = !!t.playerChrome;
  const expectsDefault =
    t.progressBarStyle !== 'none' && !t.playerChrome;
  const expectsWaveform = t.showWaveform;

  console.log(
    `\n[${t.id}] playerChrome=${t.playerChrome ?? 'none'} ` +
      `progressBarStyle=${t.progressBarStyle} ` +
      `showWaveform=${t.showWaveform}`,
  );
  ok(
    'default progress (§5) present iff expected',
    hasDefaultProgress === expectsDefault,
    `present=${hasDefaultProgress} expected=${expectsDefault}`,
  );
  ok(
    'chrome progress (§6.5) present iff expected',
    hasChromeProgress === expectsChrome,
    `present=${hasChromeProgress} expected=${expectsChrome}`,
  );
  ok(
    'no duplicate progress',
    !hasTwo,
    hasTwo ? 'BOTH §5 AND §6.5 are drawing — duplicate!' : '',
  );
  ok(
    'waveform (§7) present iff template asks',
    hasWaveform === expectsWaveform,
    `present=${hasWaveform} expected=${expectsWaveform}`,
  );
}

console.log(`\n${allOk ? 'FILTER GRAPH OK' : 'FILTER GRAPH HAS GATING BUGS'}`);
process.exit(allOk ? 0 : 1);
