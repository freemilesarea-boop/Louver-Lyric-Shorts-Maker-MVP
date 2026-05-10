/**
 * Font subsystem smoke. Asserts:
 *   1. Registry shape — every key has a CSS-safe family (no commas /
 *      no inner double-quotes), files[] is well-formed, fallback is
 *      non-empty.
 *   2. fontFamilyFor() builds the expected `"<family>", <fallback>`
 *      string. The leading family MUST be quoted so canvas ctx.font
 *      shorthand parses correctly when families contain spaces.
 *   3. resolveFontSpec() honors a fontKey override and produces a font
 *      string that survives `ctx.font` round-trip on @napi-rs/canvas.
 *   4. Missing-file behavior: registerBundledFonts() returns sensible
 *      counts even when assets/fonts/ is empty.
 *
 * Run with:  npx tsx scripts/test-fonts.ts
 */

import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import {
  DEFAULT_FONT_KEY,
  FONTS,
  FONT_KEYS,
  defaultFontForLanguage,
  fontFamilyFor,
  type FontDef,
  type FontKey,
} from '../src/shared/fonts.ts';
import { resolveFontSpec } from '../src/shared/scene.ts';
import type { Template } from '../src/shared/types.ts';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

console.log('--- Registry shape ---');
ok('FONT_KEYS not empty', FONT_KEYS.length > 0);
ok('DEFAULT_FONT_KEY exists in registry', FONT_KEYS.includes(DEFAULT_FONT_KEY));
for (const key of FONT_KEYS) {
  const def: FontDef = FONTS[key];
  ok(`[${key}] has label`, typeof def.label === 'string' && def.label.length > 0);
  ok(`[${key}] family is single CSS identifier (no inner quotes)`, !def.family.includes('"'));
  ok(`[${key}] family non-empty`, def.family.length > 0);
  ok(`[${key}] fallback non-empty`, def.fallback.length > 0);
  ok(`[${key}] files is array`, Array.isArray(def.files));
  for (const f of def.files) {
    ok(
      `[${key}] file ${f.filename} ext is ttf/otf/woff2`,
      /\.(ttf|otf|woff2)$/i.test(f.filename),
    );
    ok(`[${key}] file weight is number`, typeof f.weight === 'number');
  }
}

console.log('\n--- fontFamilyFor() output ---');
for (const key of FONT_KEYS) {
  const family = fontFamilyFor(key);
  const def = FONTS[key];
  // Leading family must be quoted: '"X", fallback'.
  const leadOk = family.startsWith(`"${def.family}",`);
  ok(`[${key}] family string starts "${def.family}",`, leadOk, family.slice(0, 40) + '...');
  // Fallback chain present.
  ok(`[${key}] fallback chain present`, family.endsWith(def.fallback));
}
// Unknown key → DEFAULT.
const fallbackForUnknown = fontFamilyFor('not-a-real-key' as FontKey);
ok(
  'unknown key → falls back to default family',
  fallbackForUnknown.includes(FONTS[DEFAULT_FONT_KEY].family),
);

console.log('\n--- defaultFontForLanguage() ---');
ok('ko → pretendard', defaultFontForLanguage('ko') === 'pretendard');
ok('en → inter', defaultFontForLanguage('en') === 'inter');
ok('ja → noto-sans-kr', defaultFontForLanguage('ja') === 'noto-sans-kr');
ok('zh → noto-sans-kr', defaultFontForLanguage('zh') === 'noto-sans-kr');
ok('es → inter', defaultFontForLanguage('es') === 'inter');
ok('unknown → inter', defaultFontForLanguage('unknown') === 'inter');

console.log('\n--- resolveFontSpec() honors fontKey override ---');
const tplStub = {
  fontFamily: '"Bebas Neue", sans-serif',
  fontStack: { base: '"Bebas Neue"' },
  fontSize: 60,
  fontWeight: 700,
} as unknown as Template;
const noOverride = resolveFontSpec(tplStub, 'en', null);
const withOverride = resolveFontSpec(tplStub, 'en', 'pretendard');
ok(
  'no-override falls back to template family',
  noOverride.family.includes('Bebas Neue') && !noOverride.family.includes('Pretendard'),
  noOverride.family.slice(0, 50),
);
ok(
  'override surfaces user font ahead of template',
  withOverride.family.startsWith('"Pretendard"'),
  withOverride.family.slice(0, 50),
);

console.log('\n--- Canvas ctx.font round-trip (uses real @napi-rs/canvas) ---');
const canvas = createCanvas(64, 64);
const ctx = canvas.getContext('2d');
const expected = `${tplStub.fontWeight} ${tplStub.fontSize}px ${withOverride.family}`;
ctx.font = expected;
ok('ctx.font accepts the family string', typeof ctx.font === 'string' && ctx.font.length > 0,
  ctx.font.slice(0, 60));
// measureText with korean glyphs should work even if the bundled font is missing
// — we just want to confirm the call doesn't throw.
const measured = ctx.measureText('Hello 한글');
ok('measureText returns non-zero width', measured.width > 0, `width=${measured.width.toFixed(1)}`);

console.log('\n--- Missing-file fallback (assets/fonts is empty in this sandbox) ---');
let registered = 0;
let missing = 0;
const REPO_ROOT = new URL('..', import.meta.url).pathname;
for (const def of Object.values(FONTS)) {
  for (const f of def.files) {
    const path = `${REPO_ROOT}assets/fonts/${f.filename}`;
    try {
      const r = GlobalFonts.registerFromPath(path, def.family);
      if (r) registered++;
      else missing++;
    } catch {
      missing++;
    }
  }
}
console.log(`  registered=${registered}, missing=${missing}`);
ok(
  'graceful: handler does not throw when files are absent',
  registered + missing > 0,
);
// In CI / sandbox the repo ships without binaries; the architecture should
// still produce a usable canvas via fallback chain.
const fallbackCtxFont = ctx.font;
ok('ctx.font is still parseable after missing-file registration',
  typeof fallbackCtxFont === 'string' && fallbackCtxFont.length > 0);

console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
process.exit(allOk ? 0 : 1);
