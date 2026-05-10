import { api } from './api';
import { FONTS } from '../../shared/fonts';

/**
 * Boot-time bundled font loader.
 *
 * On app start, asks the main process to read every TTF/OTF declared in
 * `shared/fonts.ts` from disk (packaged: from `Resources/assets/fonts/`,
 * dev: from `<repo>/assets/fonts/`). The bytes come back base64-encoded
 * over IPC; we wrap each variant in a `FontFace` and add it to
 * `document.fonts`. After this call resolves, both
 *
 *   - CSS `font-family: "Pretendard", ...` (DOM nodes), and
 *   - canvas `ctx.font = '700 60px "Pretendard", ...'` (lyric overlays)
 *
 * pick up the bundled glyphs without any further plumbing.
 *
 * Fonts that aren't present on disk return `loaded: false` from the IPC
 * and we silently skip them — the canvas / CSS fallback chain in
 * `fontFamilyFor()` keeps output sensible.
 */

export interface FontLoadReport {
  totalFiles: number;
  loaded: number;
  missing: number;
  skippedFamilies: string[];
}

let inflight: Promise<FontLoadReport> | null = null;

export function loadBundledFontsIntoDocument(): Promise<FontLoadReport> {
  if (inflight) return inflight;
  inflight = doLoad();
  return inflight;
}

async function doLoad(): Promise<FontLoadReport> {
  let totalFiles = 0;
  let loaded = 0;
  let missing = 0;
  const skippedFamilies = new Set<string>();

  let payloads;
  try {
    payloads = await api().loadBundledFonts();
  } catch (e) {
    // IPC failure (preload not ready, etc.) — degrade gracefully.
    // eslint-disable-next-line no-console
    console.warn('[fonts] loadBundledFonts IPC failed; using system fallbacks:', e);
    return { totalFiles: 0, loaded: 0, missing: 0, skippedFamilies: [] };
  }

  for (const p of payloads) {
    const def = FONTS[p.key as keyof typeof FONTS];
    if (!def) continue;
    let anyLoaded = false;
    for (const v of p.variants) {
      totalFiles++;
      if (!v.loaded || !v.base64) {
        missing++;
        continue;
      }
      try {
        const bytes = base64ToArrayBuffer(v.base64);
        const ff = new FontFace(p.family, bytes, {
          weight: String(v.weight),
          style: v.style ?? 'normal',
          display: 'swap',
        });
        await ff.load();
        document.fonts.add(ff);
        loaded++;
        anyLoaded = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[fonts] FontFace load failed for ${p.family} (${v.filename}):`, e);
        missing++;
      }
    }
    if (!anyLoaded && def.files.length > 0) {
      skippedFamilies.add(p.family);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[fonts] loaded ${loaded}/${totalFiles} files; ${missing} missing/failed.` +
      (skippedFamilies.size > 0
        ? ` Falling back to system for: ${[...skippedFamilies].join(', ')}.`
        : ''),
  );
  return {
    totalFiles,
    loaded,
    missing,
    skippedFamilies: [...skippedFamilies],
  };
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
