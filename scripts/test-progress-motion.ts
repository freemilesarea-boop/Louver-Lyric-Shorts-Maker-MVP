/**
 * Pixel-level motion verification.
 *
 * For each demo MP4, extract frames at t=0.3, t=middle, t=end-0.3 and
 * compare a horizontal stripe at the player-chrome progress y position.
 * If the rightmost-filled pixel x is the same at all three time points,
 * progress is NOT moving — fail with diagnostic.
 *
 * Run: npx tsx scripts/test-progress-motion.ts
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../src/main/render/binaries.ts';

if (!ffmpegPath) {
  console.error('ffmpeg-static not resolved.');
  process.exit(2);
}

interface Sample {
  label: string;
  path: string;
  // x position of the rightmost "filled" pixel along the sampled row.
  // -1 if no filled pixel found.
  fillX: number;
  // Average luminance along the row (sanity check for "is there content").
  avgL: number;
}

const tmp = mkdtempSync(join(tmpdir(), 'progress-motion-'));

function extractFrame(src: string, t: number, dst: string): boolean {
  const r = spawnSync(
    ffmpegPath!,
    ['-y', '-loglevel', 'error', '-ss', String(t), '-i', src, '-frames:v', '1', dst],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return r.status === 0;
}

/**
 * Read a PNG and probe for the rightmost pixel along the given y row
 * whose color saturation is high (i.e., the filled accent color, not
 * the low-alpha track background). Uses ffmpeg to extract a small
 * cropped strip to PPM, then parses raw RGB.
 */
function sampleProgressRow(
  png: string,
  y: number,
): { fillX: number; avgL: number } {
  // Crop a 1080×3 strip at y and dump raw RGB. ffmpeg can output ppm
  // which is trivially parseable.
  const ppm = png.replace(/\.png$/, `.row${y}.ppm`);
  const r = spawnSync(
    ffmpegPath!,
    [
      '-y', '-loglevel', 'error',
      '-i', png,
      '-vf', `crop=1080:1:0:${y}`,
      '-pix_fmt', 'rgb24',
      ppm,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (r.status !== 0 || !existsSync(ppm)) return { fillX: -1, avgL: 0 };
  // PPM P6 header: "P6\n<w> <h>\n<maxval>\n" then raw RGB bytes.
  const buf = readFileSync(ppm);
  // Parse header.
  let pos = 0;
  const readLine = (): string => {
    let line = '';
    while (pos < buf.length && buf[pos] !== 0x0a) {
      line += String.fromCharCode(buf[pos++]);
    }
    pos++;
    return line;
  };
  const magic = readLine();
  if (magic !== 'P6') return { fillX: -1, avgL: 0 };
  // Skip optional comment lines.
  let dims = readLine();
  while (dims.startsWith('#')) dims = readLine();
  const [w] = dims.split(/\s+/).map(Number);
  readLine(); // maxval
  const pixels = buf.subarray(pos);
  // Walk right-to-left for the first pixel that's "fill-like" — i.e.,
  // any color channel > 110 AND saturation > 30 (excludes pure track
  // greys/whites). Returns x position.
  let fillX = -1;
  let totalL = 0;
  for (let x = w - 1; x >= 0; x--) {
    const r1 = pixels[x * 3];
    const g1 = pixels[x * 3 + 1];
    const b1 = pixels[x * 3 + 2];
    const max = Math.max(r1, g1, b1);
    const min = Math.min(r1, g1, b1);
    const sat = max - min;
    totalL += (r1 + g1 + b1) / 3;
    if (fillX < 0 && max > 110 && sat > 30) {
      fillX = x;
    }
  }
  return { fillX, avgL: totalL / w };
}

interface ProbeRow {
  template: string;
  y: number;
  expectMoving: boolean;
}

const targets: ProbeRow[] = [
  // Player chrome progress (cardY=1640, cardH=220, varies by chrome
  // style). We sample at known y values for each player template.
  { template: 'apple-bold-pan', y: 1784, expectMoving: true },
  { template: 'spotify-pop-rise', y: 1800, expectMoving: true },
  { template: 'youtube-circle-pop', y: 1828, expectMoving: true },
  // Default progress at y=H*0.88=1690 for non-player templates.
  { template: 'dark-rnb-pulse', y: 1690, expectMoving: true },
  { template: 'minimal-clean', y: 1690, expectMoving: true },
];

let allOk = true;
console.log('--- Progress motion verification ---');

for (const t of targets) {
  const src = `/home/user/Louver-Lyric-Shorts-Maker-MVP/output/demo-pack/demo_${t.template}.mp4`;
  if (!existsSync(src)) {
    console.log(`  SKIP [${t.template}] — demo not found`);
    continue;
  }
  // Demo clips are 6s. Sample at t=0.3, t=3.0, t=5.5.
  const samples: Sample[] = [];
  for (const ts of [0.3, 3.0, 5.5]) {
    const dst = join(tmp, `${t.template}-${ts}.png`);
    if (!extractFrame(src, ts, dst)) {
      console.log(`  BAD [${t.template}] — frame extract failed at t=${ts}`);
      allOk = false;
      continue;
    }
    const { fillX, avgL } = sampleProgressRow(dst, t.y);
    samples.push({ label: `t=${ts}`, path: dst, fillX, avgL });
  }
  const fills = samples.map((s) => s.fillX);
  const minFill = Math.min(...fills);
  const maxFill = Math.max(...fills);
  const range = maxFill - minFill;
  const moved = range >= 100;
  // We expect the fill to GROW with time. Anti-monotonic = bug.
  const monotonic =
    samples.every((s, i) =>
      i === 0 ? true : s.fillX >= samples[i - 1].fillX - 20,
    );
  console.log(
    `  ${moved && monotonic ? 'OK ' : 'BAD'} [${t.template}] y=${t.y} ` +
      `· fill x: ${fills.join(' → ')} · range=${range}`,
  );
  if (!(moved && monotonic)) allOk = false;
}

console.log(`\n${allOk ? 'PROGRESS MOVES' : 'PROGRESS DOES NOT MOVE — needs fix'}`);
process.exit(allOk ? 0 : 1);
