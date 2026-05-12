/**
 * Generate the Lyric Shorts Maker app icon set from a single
 * 1024×1024 source PNG.
 *
 * Output:
 *   build/icon.png    — 512×512, used by Linux AppImage + electron
 *                       BrowserWindow.icon fallback
 *   build/icon.ico    — multi-size (256/128/64/48/32/16) for Windows
 *   build/icon.icns   — multi-size (1024/512/256/128/64/32/16) for
 *                       macOS .app + DMG
 *
 * Source file priority:
 *   1. build/icon-source/lv-1024.png  (real designer PNG, if committed)
 *   2. else: generate procedurally from canvas (LV red gradient design)
 *
 * To swap to a designer-provided icon later, drop a 1024×1024 PNG at
 * build/icon-source/lv-1024.png and re-run `npm run icons`. The
 * resulting build/icon.{png,ico,icns} are checked in so CI builds
 * pick them up without needing to re-run this script.
 *
 * Run: npm run icons
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

const ROOT = join(__dirname, '..');
const BUILD_DIR = join(ROOT, 'build');
const SOURCE_DIR = join(BUILD_DIR, 'icon-source');
const SOURCE_PNG = join(SOURCE_DIR, 'lv-1024.png');

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

/**
 * Procedural LV icon — matches the brand reference:
 *   · Apple-style rounded square (≈22% corner radius)
 *   · Red gradient background (top-left bright red → bottom-right
 *     deep red, with a subtle gloss highlight band in the upper half)
 *   · Black "LV" centered, bold sans-serif, vertically slightly above
 *     middle to balance with the gloss highlight
 *
 * Renders at 1024×1024 and writes to SOURCE_PNG. The downsampling
 * to per-platform sizes is handled by ImageMagick / electron-icon-
 * builder downstream.
 */
function renderSourceIcon(): Buffer {
  const SIZE = 1024;
  const RADIUS = Math.round(SIZE * 0.22); // 225 ≈ iOS rounded square

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Clip path: rounded square
  ctx.beginPath();
  roundedRectPath(ctx, 0, 0, SIZE, SIZE, RADIUS);
  ctx.closePath();
  ctx.clip();

  // Base gradient — diagonal red
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, '#FF3434');
  grad.addColorStop(0.55, '#E61E1E');
  grad.addColorStop(1, '#B40C0C');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Gloss band — slight elliptical highlight in upper half. Matches
  // the screenshot's "premium glossy" feel without making it
  // skeuomorphic. Painted via a radial gradient centered above the
  // visible area so only the bottom arc shows.
  const gloss = ctx.createRadialGradient(
    SIZE * 0.5,
    SIZE * -0.1,
    SIZE * 0.2,
    SIZE * 0.5,
    SIZE * 0.55,
    SIZE * 0.7,
  );
  gloss.addColorStop(0, 'rgba(255,255,255,0.18)');
  gloss.addColorStop(0.6, 'rgba(255,255,255,0.04)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle inner darkening at the bottom for depth
  const depth = ctx.createLinearGradient(0, SIZE * 0.6, 0, SIZE);
  depth.addColorStop(0, 'rgba(0,0,0,0)');
  depth.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // "LV" text — try the bundled brand font, fall back to system.
  // The reference image uses a heavy sans (Helvetica/Inter Black
  // weight). We layer text shadow + main fill for legibility on
  // both Dock (small) and Finder (large) scales.
  const fontFamily = pickHeavySans();
  ctx.fillStyle = '#0E0E0E';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Letter-spacing trick: draw L and V separately to control gap.
  const fontSize = Math.round(SIZE * 0.62);
  ctx.font = `900 ${fontSize}px ${fontFamily}`;
  // Soft dark shadow under the letters for depth.
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = SIZE * 0.012;
  ctx.shadowOffsetY = SIZE * 0.008;
  // Center vertically with a slight upward bias so the letters
  // sit at the optical center, not the geometric one.
  const cy = SIZE * 0.5 + fontSize * 0.05;
  // Two-letter spacing: L at 36%, V at 64% of width.
  ctx.fillText('L', SIZE * 0.36, cy);
  ctx.fillText('V', SIZE * 0.64, cy);

  return canvas.toBuffer('image/png');
}

function roundedRectPath(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function pickHeavySans(): string {
  const families = GlobalFonts.families.map((f) => f.family);
  // Prefer Pretendard Black (bundled) since we already ship it;
  // then any system heavy sans.
  for (const want of [
    'Pretendard',
    'Inter',
    'SF Pro Display',
    'Helvetica Neue',
    'Helvetica',
    'Arial Black',
    'Arial',
    'DejaVu Sans',
  ]) {
    if (families.includes(want)) return `'${want}'`;
  }
  return 'sans-serif';
}

function run(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} → exit ${r.status}`);
  }
}

async function main(): Promise<void> {
  ensureDir(BUILD_DIR);
  ensureDir(SOURCE_DIR);

  // 1. Source PNG — prefer designer-provided, else generate.
  let sourceBuf: Buffer;
  if (existsSync(SOURCE_PNG)) {
    console.log(`[icons] using designer source: ${SOURCE_PNG}`);
    sourceBuf = readFileSync(SOURCE_PNG);
  } else {
    console.log(`[icons] generating procedural LV icon at ${SOURCE_PNG}`);
    sourceBuf = renderSourceIcon();
    writeFileSync(SOURCE_PNG, sourceBuf);
  }

  // 2. Linux AppImage: 512×512 PNG (electron-builder accepts up to
  //    1024 but 512 is the common AppImage size + half the file size).
  const pngOut = join(BUILD_DIR, 'icon.png');
  console.log(`[icons] writing ${pngOut} (512×512)`);
  run('convert', [SOURCE_PNG, '-resize', '512x512', pngOut]);

  // 3. Windows ICO: multi-size from 16 to 256. electron-builder
  //    requires AT LEAST 256×256 inside the .ico.
  const icoOut = join(BUILD_DIR, 'icon.ico');
  console.log(`[icons] writing ${icoOut} (multi-size 16…256)`);
  run('convert', [
    SOURCE_PNG,
    '-define',
    'icon:auto-resize=256,128,96,64,48,32,16',
    icoOut,
  ]);

  // 4. macOS ICNS: real container format. ImageMagick on Linux
  //    doesn't ship libicns, so we use @fiahfy/icns-convert (pure
  //    JS, no native deps). The encoder reads multiple PNG sizes and
  //    packs them into the .icns container with the correct OSType
  //    tags. electron-builder requires an actual ICNS — a PNG
  //    renamed to .icns is rejected.
  const icnsOut = join(BUILD_DIR, 'icon.icns');
  console.log(`[icons] writing ${icnsOut} (multi-size 16…1024)`);
  await buildIcns(SOURCE_PNG, icnsOut);

  console.log('[icons] done.');
}

async function buildIcns(sourcePng: string, outPath: string): Promise<void> {
  // electron-icon-builder / icns spec want these sizes baked in.
  // 1024 = retina @ 512pt, 512 = retina @ 256pt, etc.
  const sizes = [16, 32, 64, 128, 256, 512, 1024];

  // @fiahfy/icns-convert is in optionalDependencies because it
  // transitively depends on sharp@0.27.2 which fails to build on
  // GitHub's macos-latest runner (missing system libvips). CI uses
  // `npm ci --omit=optional` so this package may not be installed.
  // That's fine — CI never regenerates icons; build/icon.icns is a
  // committed static asset. We only need the package when a
  // maintainer runs `npm run icons` locally.
  let convertFn: ((buffers: Buffer[]) => Promise<Buffer>) | null = null;
  try {
    const mod = (await import('@fiahfy/icns-convert')) as {
      convert: (buffers: Buffer[]) => Promise<Buffer>;
    };
    convertFn = mod.convert;
  } catch {
    console.error(
      `[icons] @fiahfy/icns-convert is not installed. To regenerate ` +
        `build/icon.icns, run:\n\n  npm install --no-save @fiahfy/icns-convert\n\n` +
        `Then re-run npm run icons. The committed icon.icns is fine for ` +
        `CI/distribution; only run this locally when the source PNG changes.`,
    );
    process.exit(1);
  }

  const tmpDir = join(BUILD_DIR, '.icns-tmp');
  ensureDir(tmpDir);
  const pngBuffers: Buffer[] = [];
  for (const s of sizes) {
    const out = join(tmpDir, `${s}.png`);
    run('convert', [sourcePng, '-resize', `${s}x${s}`, out]);
    pngBuffers.push(readFileSync(out));
  }
  const icns = await convertFn(pngBuffers);
  writeFileSync(outPath, icns);
}

main();
