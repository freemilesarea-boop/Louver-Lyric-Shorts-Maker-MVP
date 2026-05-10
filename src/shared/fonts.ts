import type { LanguageCode } from './types';

/**
 * Font registry — single source of truth for the font feature.
 *
 * The same FontKey drives:
 *   - Renderer-process FontFace registration (assets bundled inside the
 *     Electron package, loaded via main-process IPC at boot).
 *   - Canvas `ctx.font` strings produced by `fontFamilyFor()`. Both the
 *     live preview and the export overlay generator (overlays.ts) call
 *     into the same scene renderer, so picking a font here changes
 *     both surfaces in one shot.
 *   - Headless `@napi-rs/canvas` `GlobalFonts.registerFromPath()` calls
 *     in `scripts/demo-render-pack.ts`.
 *
 * Why we don't use ffmpeg `drawtext` for fonts: `ffmpeg-static`'s Linux
 * static build ships *without* drawtext (see Phase 1 notes). All lyric
 * text rendering happens in canvas; ffmpeg only composes pre-rendered
 * transparent PNGs. So "fontfile arg to drawtext" doesn't apply — the
 * equivalent in our pipeline is registering the font in canvas before
 * paint. End-to-end behavior is identical: one fontKey → both the
 * preview image and the exported MP4 use the same glyphs.
 */

export type FontKey =
  | 'pretendard'
  | 'noto-sans-kr'
  | 'inter'
  | 'sf-pro-display'
  | 'caveat'
  | 'orbitron'
  | 'vt323';

export interface FontFile {
  /** OS-independent filename inside assets/fonts/. TTF/OTF preferred —
   *  `@napi-rs/canvas` reads those directly, FontFace handles them too. */
  filename: string;
  weight: number;
  style?: 'normal' | 'italic';
}

export interface FontDef {
  key: FontKey;
  /** UI display name. */
  label: string;
  /** Canonical CSS / canvas family. Quoted-string-safe (no quotes inside). */
  family: string;
  /** Bundled file list. May be empty when the font is intentionally
   *  system-only (e.g. SF Pro on macOS). */
  files: FontFile[];
  /** Fallback chain appended after the canonical family — used when the
   *  bundled file is missing or the platform doesn't have the system
   *  font installed. Already CSS-comma-formatted. */
  fallback: string;
  /** UI hint: which language(s) this font is best for. */
  bestFor: LanguageCode[];
}

export const FONTS: Record<FontKey, FontDef> = {
  pretendard: {
    key: 'pretendard',
    label: 'Pretendard',
    family: 'Pretendard',
    files: [
      { filename: 'Pretendard-Regular.ttf', weight: 400 },
      { filename: 'Pretendard-Bold.ttf', weight: 700 },
    ],
    fallback:
      '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif',
    bestFor: ['ko', 'en'],
  },
  'noto-sans-kr': {
    key: 'noto-sans-kr',
    label: 'Noto Sans KR',
    family: 'Noto Sans KR',
    files: [
      { filename: 'NotoSansKR-Regular.ttf', weight: 400 },
      { filename: 'NotoSansKR-Bold.ttf', weight: 700 },
    ],
    fallback: '"Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    bestFor: ['ko'],
  },
  inter: {
    key: 'inter',
    label: 'Inter',
    family: 'Inter',
    files: [
      { filename: 'Inter-Regular.ttf', weight: 400 },
      { filename: 'Inter-Bold.ttf', weight: 700 },
    ],
    fallback: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
    bestFor: ['en', 'es'],
  },
  'sf-pro-display': {
    key: 'sf-pro-display',
    label: 'SF Pro Display',
    family: 'SF Pro Display',
    // SF Pro is system-only on macOS; bundling its file violates Apple's
    // license. We rely on the system version when present and fall back
    // to Inter/Helvetica elsewhere.
    files: [],
    fallback:
      '"-apple-system", "BlinkMacSystemFont", "Inter", "Helvetica Neue", system-ui, sans-serif',
    bestFor: ['en'],
  },
  caveat: {
    key: 'caveat',
    label: 'Caveat (handwritten)',
    family: 'Caveat',
    files: [{ filename: 'Caveat-Bold.ttf', weight: 700 }],
    fallback: 'cursive, "Bradley Hand", system-ui, sans-serif',
    bestFor: ['en'],
  },
  orbitron: {
    key: 'orbitron',
    label: 'Orbitron (sci-fi display)',
    family: 'Orbitron',
    files: [{ filename: 'Orbitron-Bold.ttf', weight: 700 }],
    fallback: '"Bank Gothic", Impact, system-ui, sans-serif',
    bestFor: ['en'],
  },
  vt323: {
    key: 'vt323',
    label: 'VT323 (terminal mono)',
    family: 'VT323',
    files: [{ filename: 'VT323-Regular.ttf', weight: 400 }],
    fallback: '"Courier New", Courier, monospace',
    bestFor: ['en'],
  },
};

export const FONT_KEYS: FontKey[] = Object.keys(FONTS) as FontKey[];

/** Default when the user hasn't picked anything (and no template default
 *  is in play). Pretendard covers KO + EN well so it's a safe pick. */
export const DEFAULT_FONT_KEY: FontKey = 'pretendard';

/**
 * Build a CSS / canvas font-family string for `key`.
 *
 *   - Always wraps the canonical family in quotes so families with spaces
 *     (`"Noto Sans KR"`) parse correctly when assembled into a longer
 *     `ctx.font` shorthand.
 *   - Appends the fallback chain so the same string also renders
 *     reasonably when the bundled font hasn't loaded (or doesn't exist).
 */
export function fontFamilyFor(key: FontKey): string {
  const def = FONTS[key];
  if (!def) return FONTS[DEFAULT_FONT_KEY].family + ', system-ui, sans-serif';
  return `"${def.family}", ${def.fallback}`;
}

/**
 * Pick the best FontKey for a language. Used by `resolveFontSpec` when
 * the user hasn't manually picked a font and the template doesn't have
 * an explicit choice either.
 */
export function defaultFontForLanguage(lang: LanguageCode): FontKey {
  switch (lang) {
    case 'ko':
      return 'pretendard';
    case 'ja':
    case 'zh':
      return 'noto-sans-kr'; // Noto Sans family covers all CJK
    case 'en':
    case 'es':
    case 'unknown':
    default:
      return 'inter';
  }
}
