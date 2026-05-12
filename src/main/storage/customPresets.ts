import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AnimationPreset,
  CustomPreset,
  FxPreset,
  LanguageCode,
  LayoutOverrides,
  MotionPreset,
  ReactiveMode,
  StyleOverrides,
} from '../../shared/types';

/**
 * Custom preset persistence.
 *
 * Storage: `<userData>/custom-presets.json`. Atomic write via temp +
 * rename so a crash mid-save can't corrupt the file. Reads are
 * fault-tolerant — if the file is missing, empty, or malformed we log and
 * return an empty list rather than crash.
 *
 * Path resolution (resolved fresh on every call so test env-var overrides
 * applied after this module loads still take effect):
 *   1. `process.env.LSM_USER_DATA_DIR` — test seam. Used by rc-qa.ts so
 *      it can run the round-trip without an Electron `app` instance and
 *      without spawning a child process to mock 'electron'.
 *   2. `app.getPath('userData')` — production. Electron resolves to
 *      `~/Library/Application Support/<app>` (macOS), `%APPDATA%\<app>`
 *      (Windows), or `~/.config/<app>` (Linux).
 */

const FILE_NAME = 'custom-presets.json';
const FILE_VERSION = 1;

interface StoredFile {
  version: number;
  presets: CustomPreset[];
}

const EMPTY: StoredFile = { version: FILE_VERSION, presets: [] };

function userDataDir(): string {
  // Env-var seam first — production never sets this. Read on every call
  // so test code that sets the env after module import still works.
  const fromEnv = process.env.LSM_USER_DATA_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return app.getPath('userData');
}

function filePath(): string {
  return join(userDataDir(), FILE_NAME);
}

export async function listPresets(): Promise<CustomPreset[]> {
  const file = await readFile();
  return [...file.presets].sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface SaveInput {
  name: string;
  templateId: string;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  cinematicFxPreset: FxPreset;
  language: LanguageCode | null;
  /** Optional user style tweaks. Stored alongside the preset so saving a
   *  custom look + reloading later restores the same border / lyric
   *  colors / scale the user picked. */
  styleOverrides?: StyleOverrides;
  /** Optional per-element drag positions. Phase 5-5+. Older presets
   *  saved before this field existed roundtrip as undefined and reset
   *  to template defaults on load. */
  layoutOverrides?: LayoutOverrides;
  /**
   * If a preset with the same (case-insensitive) name already exists and
   * `forceOverwrite` is false, the IPC reply includes `conflict: true` so
   * the UI can confirm before overwriting.
   */
  forceOverwrite?: boolean;
}

export interface SaveResult {
  ok: boolean;
  preset?: CustomPreset;
  conflict?: boolean;
  existingId?: string;
  error?: string;
}

export async function savePreset(input: SaveInput): Promise<SaveResult> {
  const trimmed = (input.name ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, error: '프리셋 이름을 입력해주세요.' };
  }
  if (trimmed.length > 60) {
    return { ok: false, error: '프리셋 이름은 60자 이하로 입력해주세요.' };
  }

  const file = await readFile();
  const lower = trimmed.toLowerCase();
  const existing = file.presets.find((p) => p.name.trim().toLowerCase() === lower);

  if (existing && !input.forceOverwrite) {
    return { ok: false, conflict: true, existingId: existing.id };
  }

  const now = Date.now();
  // Persist style/layout overrides only when at least one knob is set,
  // so the JSON file stays small for default presets.
  const overrides = input.styleOverrides && Object.keys(input.styleOverrides).length > 0
    ? input.styleOverrides
    : undefined;
  const layout = input.layoutOverrides && Object.keys(input.layoutOverrides).length > 0
    ? input.layoutOverrides
    : undefined;
  let next: CustomPreset;
  if (existing) {
    next = {
      ...existing,
      name: trimmed,
      templateId: input.templateId,
      motionPreset: input.motionPreset,
      animationPreset: input.animationPreset,
      reactiveMode: input.reactiveMode,
      cinematicFxPreset: input.cinematicFxPreset,
      language: input.language,
      styleOverrides: overrides,
      layoutOverrides: layout,
      updatedAt: now,
    };
    file.presets = file.presets.map((p) => (p.id === existing.id ? next : p));
  } else {
    next = {
      id: randomUUID(),
      name: trimmed,
      templateId: input.templateId,
      motionPreset: input.motionPreset,
      animationPreset: input.animationPreset,
      reactiveMode: input.reactiveMode,
      cinematicFxPreset: input.cinematicFxPreset,
      language: input.language,
      styleOverrides: overrides,
      layoutOverrides: layout,
      createdAt: now,
      updatedAt: now,
    };
    file.presets = [...file.presets, next];
  }

  await writeFile(file);
  return { ok: true, preset: next };
}

export async function deletePreset(id: string): Promise<{ ok: boolean }> {
  const file = await readFile();
  const filtered = file.presets.filter((p) => p.id !== id);
  if (filtered.length === file.presets.length) {
    // Not found — still return ok so the UI doesn't get stuck on a stale entry.
    return { ok: true };
  }
  file.presets = filtered;
  await writeFile(file);
  return { ok: true };
}

/* --------------------------- file IO + recovery --------------------------- */

async function readFile(): Promise<StoredFile> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath(), 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY, presets: [] };
    }
    // eslint-disable-next-line no-console
    console.warn('[custom-presets] read failed, falling back to empty:', e);
    return { ...EMPTY, presets: [] };
  }
  if (!raw.trim()) return { ...EMPTY, presets: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Corrupt JSON — back up the bad file so the user can inspect it later,
    // then return empty so the app keeps working.
    // eslint-disable-next-line no-console
    console.warn('[custom-presets] JSON parse failed, archiving and recovering:', e);
    try {
      await fs.rename(filePath(), `${filePath()}.corrupt.${Date.now()}.json`);
    } catch {
      // ignore — best effort
    }
    return { ...EMPTY, presets: [] };
  }

  return validateAndCoerce(parsed);
}

function validateAndCoerce(input: unknown): StoredFile {
  if (!input || typeof input !== 'object') return { ...EMPTY, presets: [] };
  const obj = input as { version?: unknown; presets?: unknown };
  const presets: CustomPreset[] = Array.isArray(obj.presets)
    ? obj.presets.filter(isCustomPreset)
    : [];
  return { version: FILE_VERSION, presets };
}

function isCustomPreset(x: unknown): x is CustomPreset {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.templateId === 'string' &&
    typeof p.motionPreset === 'string' &&
    typeof p.animationPreset === 'string' &&
    typeof p.reactiveMode === 'string' &&
    typeof p.cinematicFxPreset === 'string' &&
    (p.language === null || typeof p.language === 'string') &&
    typeof p.createdAt === 'number' &&
    typeof p.updatedAt === 'number'
  );
}

async function writeFile(file: StoredFile): Promise<void> {
  const out = filePath();
  await fs.mkdir(join(out, '..'), { recursive: true });
  // Atomic write: write to a temp sibling then rename.
  const tmp = `${out}.tmp.${process.pid}.${Date.now()}`;
  const body = JSON.stringify({ version: FILE_VERSION, presets: file.presets }, null, 2);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, out);
}
