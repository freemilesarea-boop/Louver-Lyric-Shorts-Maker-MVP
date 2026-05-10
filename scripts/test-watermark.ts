/**
 * Watermark smoke. Verifies:
 *   1. paintWatermark draws nothing when enabled=false (canvas stays clean).
 *   2. paintWatermark draws nothing when shouldShowWatermark predicate
 *      rejects (null cfg).
 *   3. Each position lands the mark in the expected canvas quadrant —
 *      we count non-transparent pixels per quadrant after painting.
 *   4. Empty text falls back to DEFAULT_WATERMARK_TEXT.
 *   5. Custom text actually paints (different pixel count than empty).
 *
 * Uses @napi-rs/canvas (same as demo-render-pack) so the assertions run
 * without an Electron renderer.
 *
 * Run with:  npx tsx scripts/test-watermark.ts
 */

import { createCanvas } from '@napi-rs/canvas';
import {
  DEFAULT_WATERMARK_TEXT,
  WATERMARK_POSITIONS,
  effectiveWatermarkText,
  paintWatermark,
  shouldShowWatermark,
  type WatermarkConfig,
  type WatermarkPosition,
} from '../src/shared/watermark.ts';

const W = 1080;
const H = 1920;

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

interface Quadrants {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
  center: number;
  total: number;
}

function countNonTransparent(buf: Uint8ClampedArray): Quadrants {
  // RGBA, row-major. We measure four corner quadrants + a small center
  // square to identify where the mark landed.
  const cx = W / 2;
  const cy = H / 2;
  const cBox = { x0: cx - 200, x1: cx + 200, y0: cy - 100, y1: cy + 100 };
  let topLeft = 0, topRight = 0, bottomLeft = 0, bottomRight = 0, center = 0, total = 0;
  // Sample every 4th pixel for speed — well under the watermark glyph size.
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      const idx = (y * W + x) * 4;
      const a = buf[idx + 3];
      if (a === 0) continue;
      total++;
      if (x < cx && y < cy) topLeft++;
      else if (x >= cx && y < cy) topRight++;
      else if (x < cx && y >= cy) bottomLeft++;
      else bottomRight++;
      if (x >= cBox.x0 && x < cBox.x1 && y >= cBox.y0 && y < cBox.y1) center++;
    }
  }
  return { topLeft, topRight, bottomLeft, bottomRight, center, total };
}

function freshCanvas() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  return { canvas: c, ctx };
}

function rawPixels(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>): Uint8ClampedArray {
  return ctx.getImageData(0, 0, W, H).data;
}

console.log('--- shouldShowWatermark predicate ---');
ok('null cfg → false', shouldShowWatermark(null) === false);
ok('undefined cfg → false', shouldShowWatermark(undefined) === false);
ok('enabled=false → false',
  shouldShowWatermark({ enabled: false, text: '', position: 'bottom_right' }) === false);
ok('enabled=true → true',
  shouldShowWatermark({ enabled: true, text: '', position: 'bottom_right' }) === true);

console.log('\n--- effectiveWatermarkText fallback ---');
ok('empty → default',
  effectiveWatermarkText({ enabled: true, text: '', position: 'bottom_right' }) === DEFAULT_WATERMARK_TEXT);
ok('whitespace → default',
  effectiveWatermarkText({ enabled: true, text: '   ', position: 'bottom_right' }) === DEFAULT_WATERMARK_TEXT);
ok('custom text preserved',
  effectiveWatermarkText({ enabled: true, text: '@hello', position: 'bottom_right' }) === '@hello');

console.log('\n--- paintWatermark no-op cases ---');
{
  const { ctx } = freshCanvas();
  paintWatermark(ctx as unknown as CanvasRenderingContext2D, W, H, null);
  const q = countNonTransparent(rawPixels(ctx));
  ok('null cfg → fully transparent canvas', q.total === 0, `total=${q.total}`);
}
{
  const { ctx } = freshCanvas();
  paintWatermark(ctx as unknown as CanvasRenderingContext2D, W, H, {
    enabled: false,
    text: 'x',
    position: 'bottom_right',
  });
  const q = countNonTransparent(rawPixels(ctx));
  ok('enabled=false → fully transparent canvas', q.total === 0, `total=${q.total}`);
}

console.log('\n--- paintWatermark position routing ---');
const expectedQuadrant: Record<WatermarkPosition, keyof Omit<Quadrants, 'total' | 'center'>> = {
  top_left: 'topLeft',
  top_right: 'topRight',
  bottom_left: 'bottomLeft',
  bottom_right: 'bottomRight',
  center_fade: 'topLeft', // center text spans across — checked separately below
};

for (const pos of WATERMARK_POSITIONS) {
  const { ctx } = freshCanvas();
  const cfg: WatermarkConfig = { enabled: true, text: '', position: pos };
  paintWatermark(ctx as unknown as CanvasRenderingContext2D, W, H, cfg);
  const q = countNonTransparent(rawPixels(ctx));

  ok(`[${pos}] paints something`, q.total > 0, `total=${q.total}`);

  if (pos === 'center_fade') {
    // Center text must land in the center sample box.
    ok(`[${pos}] mark in center box`, q.center > 0, `center=${q.center}`);
  } else {
    // Corner positions: the expected quadrant must dominate.
    const exp = expectedQuadrant[pos];
    const others = (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).filter(
      (k) => k !== exp,
    );
    const expCount = q[exp];
    const otherMax = Math.max(...others.map((k) => q[k]));
    ok(
      `[${pos}] mark concentrated in ${exp}`,
      expCount > 0 && expCount > otherMax,
      `${exp}=${expCount} vs max-other=${otherMax}`,
    );
  }
}

console.log('\n--- custom text vs default text differ ---');
{
  const cfg1: WatermarkConfig = { enabled: true, text: '', position: 'bottom_right' };
  const cfg2: WatermarkConfig = {
    enabled: true,
    text: 'A',
    position: 'bottom_right',
  };
  const a = freshCanvas();
  paintWatermark(a.ctx as unknown as CanvasRenderingContext2D, W, H, cfg1);
  const b = freshCanvas();
  paintWatermark(b.ctx as unknown as CanvasRenderingContext2D, W, H, cfg2);
  const qa = countNonTransparent(rawPixels(a.ctx));
  const qb = countNonTransparent(rawPixels(b.ctx));
  ok('custom 1-char text paints fewer pixels than default phrase',
    qb.total > 0 && qb.total < qa.total,
    `default=${qa.total} custom=${qb.total}`);
}

console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
process.exit(allOk ? 0 : 1);
