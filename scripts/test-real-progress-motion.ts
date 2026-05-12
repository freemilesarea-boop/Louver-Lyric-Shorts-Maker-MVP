/**
 * End-to-end progress motion test using the PRODUCTION render pipeline
 * (not the stale demo-pack stub). Renders one short clip per template
 * that has a progress bar + extracts t=0.3 / mid / end frames + checks
 * the rightmost saturated pixel x position in the progress y row.
 *
 * The fill should grow with time. Anti-monotonic = the progress bar
 * isn't actually advancing.
 *
 * Run: npx tsx scripts/test-real-progress-motion.ts
 */

import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../src/main/render/binaries.ts';
import { runRender } from '../src/main/render/pipeline.ts';
import { progressBarGeom } from '../src/shared/playerChrome.ts';
import type { RenderRequest, Template } from '../src/shared/types.ts';
import { templates } from '../src/renderer/templates/templates.ts';

if (!ffmpegPath) {
  console.error('ffmpeg-static not resolved.');
  process.exit(2);
}

const DURATION = 6 as const;

async function lavfi(filter: string, outPath: string, video: boolean): Promise<void> {
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filter];
  if (video) args.push('-frames:v', '1', '-update', '1');
  args.push(outPath);
  const r = spawnSync(ffmpegPath!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`lavfi: ${r.stderr?.toString().slice(-300) ?? ''}`);
  }
}

interface MotionResult {
  template: string;
  y: number;
  fillsAtTimes: number[];
  monotonic: boolean;
  range: number;
}

function sampleProgressFillX(
  png: string,
  y: number,
  xRange: { start: number; end: number },
): number {
  const ppm = png + '.row.ppm';
  const r = spawnSync(
    ffmpegPath!,
    ['-y', '-loglevel', 'error', '-i', png, '-vf', `crop=1080:1:0:${y}`, '-pix_fmt', 'rgb24', ppm],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (r.status !== 0 || !existsSync(ppm)) return -1;
  const buf = readFileSync(ppm);
  let pos = 0;
  const readLine = (): string => {
    let s = '';
    while (pos < buf.length && buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]);
    pos++;
    return s;
  };
  if (readLine() !== 'P6') return -1;
  let dims = readLine();
  while (dims.startsWith('#')) dims = readLine();
  const [w] = dims.split(/\s+/).map(Number);
  readLine();
  const px = buf.subarray(pos);
  // Phase 5-11 stabilization fix: constrain the search to the bar's
  // actual horizontal extent. Before this, the loop walked the whole
  // 1080-pixel frame width and could lock onto BACKGROUND pixels
  // outside the bar (e.g. on the dark-blue test gradient at x>=974
  // the pixels read lum=20/sat=17 which accidentally trips the
  // "dark fill on light bg" branch). Result was a fake fillX = right
  // edge of frame at every t. With xRange clamped to (g.x, g.x+g.w)
  // we only consider pixels that actually belong to the progress
  // bar.
  const xStart = Math.max(0, Math.min(w - 1, xRange.start));
  const xEnd = Math.max(0, Math.min(w - 1, xRange.end));
  for (let x = xEnd; x >= xStart; x--) {
    const r1 = px[x * 3];
    const g1 = px[x * 3 + 1];
    const b1 = px[x * 3 + 2];
    const max = Math.max(r1, g1, b1);
    const min = Math.min(r1, g1, b1);
    const sat = max - min;
    // Filled accent: high saturation OR very bright (white fills on dark bg)
    // OR very dark (dark fills on light bg).
    const luminance = (r1 + g1 + b1) / 3;
    const looksFilled =
      (sat > 70 && max > 120) ||
      (luminance > 230) ||
      (luminance < 30 && sat < 20); // dark fill on minimal-white
    if (looksFilled) return x;
  }
  return -1;
}

async function main(): Promise<void> {
  const work = await fs.mkdtemp(join(tmpdir(), 'real-progress-'));
  const darkBg = join(work, 'bg-dark.png');
  const lightBg = join(work, 'bg-light.png');
  const audioPath = join(work, 'audio.wav');
  // Phase 5-11 stabilization: render TWO photo backgrounds and pick
  // the one that contrasts with each template's progress fill color.
  // Without this, minimal-white (lyricColor=#111111 dark fill) is
  // invisible on the dark-blue gradient — the detector then locks on
  // to the *track* (also dark, same color family) which is full-width
  // at every t, producing range=0 even though the production fill is
  // actually advancing correctly. The two-bg fix is realistic anyway
  // since users always pick a photo that contrasts with the template
  // they chose (otherwise the lyrics themselves would be invisible).
  await lavfi(
    'gradients=size=1080x1920:c0=0x101030:c1=0x303060:duration=1',
    darkBg,
    true,
  );
  await lavfi(
    'gradients=size=1080x1920:c0=0xf2f2f2:c1=0xd0d0d0:duration=1',
    lightBg,
    true,
  );
  await lavfi(`sine=frequency=220:duration=${DURATION}`, audioPath, false);

  // One template per "progress class": player-chrome + non-player.
  // `bg` selects the contrast-appropriate photo for the template's
  // lyricColor / accent so the detector can actually see the fill.
  // `xRange` constrains the row-walk to the bar's actual horizontal
  // extent so we don't lock onto background pixels (see comment in
  // sampleProgressFillX above).
  const probes: Array<{
    template: Template;
    y: number;
    label: string;
    bg: string;
    xRange: { start: number; end: number };
  }> = [
    {
      template: templates.find((t) => t.id === 'apple-music-inspired')!,
      y: 1786, // y from progressBarGeom('apple-like') + 2 (mid of h=4 bar)
      label: 'apple (chrome §6.5)',
      bg: darkBg, // apple uses red accent — visible on any bg
      // apple chrome: cardX=80, cardW=920, g.x=cardX+28=108, g.w=cardW-56=864
      xRange: { start: 108, end: 108 + 864 - 1 },
    },
    {
      template: templates.find((t) => t.id === 'minimal-white')!,
      y: 1693, // y=1690 + 3 (mid of h=6 bar)
      label: 'minimal-white (default §5)',
      bg: lightBg, // minimal-white draws DARK fill — needs light photo
      // default §5: margin=80, fullW=920 → bar spans x=80 to x=1000
      xRange: { start: 80, end: 80 + 920 - 1 },
    },
  ];

  const results: MotionResult[] = [];
  let allOk = true;

  for (const p of probes) {
    const out = join(work, `${p.template.id}.mp4`);
    const req: RenderRequest = {
      imagePath: p.bg,
      audioPath,
      lyrics: [],
      template: p.template,
      startSec: 0,
      durationSec: DURATION as unknown as 15,
      highlightKorean: false,
      overlays: [],
      motionPreset: 'none',
      animationPreset: 'none',
      reactiveMode: 'none',
      fxPreset: 'none',
    };
    process.stdout.write(`[${p.label}] rendering... `);
    await runRender(req, out, () => undefined);
    console.log('done');

    const fills: number[] = [];
    for (const ts of [0.3, 3.0, 5.5]) {
      const frame = join(work, `${p.template.id}-${ts}.png`);
      spawnSync(
        ffmpegPath!,
        ['-y', '-loglevel', 'error', '-ss', String(ts), '-i', out, '-frames:v', '1', frame],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      fills.push(sampleProgressFillX(frame, p.y, p.xRange));
    }
    const range = Math.max(...fills) - Math.min(...fills);
    const monotonic = fills.every((f, i) => (i === 0 ? true : f >= fills[i - 1] - 30));
    results.push({ template: p.label, y: p.y, fillsAtTimes: fills, monotonic, range });
    const moved = range >= 200;
    console.log(
      `  ${moved && monotonic ? 'OK ' : 'BAD'} fillX at t=0.3/3.0/5.5: ${fills.join(' / ')} ` +
        `· range=${range} ${monotonic ? '↑' : '✗'}`,
    );
    if (!(moved && monotonic)) allOk = false;
  }

  console.log(`\n${allOk ? 'PROGRESS MOVES (production)' : 'PROGRESS DOES NOT MOVE'}`);
  if (allOk) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  } else {
    console.log(`Kept workdir: ${work}`);
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
