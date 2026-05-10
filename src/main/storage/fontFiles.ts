import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FONTS, type FontFile, type FontKey } from '../../shared/fonts';

/**
 * Bundled font reader.
 *
 * Resolves the on-disk location of font files in three contexts:
 *   1. Production (packaged): `extraResources` in package.json copies
 *      `assets/fonts/` to `<app>/Resources/assets/fonts/`. We read from
 *      `process.resourcesPath`.
 *   2. Dev (electron-vite dev): app is run from the repo root; assets
 *      live at `<repoRoot>/assets/fonts/`.
 *   3. Tests / CLI: the renderer process isn't running. Callers use
 *      `resolveFontFilePath()` directly with `process.cwd()`.
 *
 * Missing files are non-fatal: callers receive `loaded: false` for that
 * file and continue. The CSS fallback chain (in `fontFamilyFor`) keeps
 * canvas output sensible.
 */

export interface BundledFontPayload {
  key: FontKey;
  /** Family + per-file metadata + the actual buffer (base64 in IPC). */
  family: string;
  variants: Array<{
    weight: number;
    style: 'normal' | 'italic';
    /** base64-encoded TTF/OTF bytes. Empty when the file isn't present. */
    base64: string;
    filename: string;
    loaded: boolean;
  }>;
}

function fontsDir(): string {
  // Packaged build: `process.resourcesPath` points at the .app's
  // Resources/ folder (or equivalent on Win/Linux). Dev: cwd is repo root.
  // We prefer process.resourcesPath when it actually contains an
  // assets/fonts dir so the dev fallback doesn't surprise packaged
  // installations.
  const packaged = app?.isPackaged
    ? join(process.resourcesPath, 'assets', 'fonts')
    : null;
  if (packaged) return packaged;
  return join(process.cwd(), 'assets', 'fonts');
}

export function resolveFontFilePath(file: FontFile): string {
  return join(fontsDir(), file.filename);
}

async function readVariant(file: FontFile): Promise<{
  weight: number;
  style: 'normal' | 'italic';
  base64: string;
  filename: string;
  loaded: boolean;
}> {
  const path = resolveFontFilePath(file);
  try {
    const buf = await fs.readFile(path);
    return {
      weight: file.weight,
      style: file.style ?? 'normal',
      base64: buf.toString('base64'),
      filename: file.filename,
      loaded: true,
    };
  } catch {
    // ENOENT or permission — non-fatal.
    return {
      weight: file.weight,
      style: file.style ?? 'normal',
      base64: '',
      filename: file.filename,
      loaded: false,
    };
  }
}

export async function loadBundledFonts(): Promise<BundledFontPayload[]> {
  const out: BundledFontPayload[] = [];
  for (const def of Object.values(FONTS)) {
    const variants = await Promise.all(def.files.map(readVariant));
    out.push({ key: def.key, family: def.family, variants });
  }
  return out;
}
