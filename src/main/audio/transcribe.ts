import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../render/binaries';
import type { LanguageCode, LyricLine } from '../../shared/types';

/**
 * Whisper transcription support.
 *
 * The app does NOT bundle whisper — it would balloon the install. Instead
 * we look for a whisper-compatible CLI on the user's PATH at request time.
 * Two flavors are supported:
 *
 *   - `whisper`         OpenAI's official Python whisper CLI
 *   - `whisper-cpp` /   ggerganov/whisper.cpp's `main` binary, also
 *     `main`            sometimes installed as `whisper-cpp`
 *
 * If neither is found, the IPC handler returns a structured "not installed"
 * error and the renderer surfaces a friendly Korean message + install hint.
 *
 * Audio is sliced by ffmpeg first so whisper only sees the user's selected
 * clip range. This keeps transcription fast and aligns timestamps to the
 * clip's local time (0..durationSec).
 */

export type TranscribeBinary =
  | { kind: 'python-whisper'; bin: string }
  | { kind: 'whisper-cpp'; bin: string };

export interface TranscribeRequest {
  audioPath: string;
  startSec: number;
  durationSec: number;
  /** ISO-639-1 hint or 'auto'. Maps to whisper's --language flag. */
  languageHint?: LanguageCode | 'auto';
}

export interface TranscribedLine {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeOk {
  lines: TranscribedLine[];
  rawText: string;
  language: string;
}

export class WhisperNotInstalledError extends Error {
  constructor() {
    super('Whisper가 설치되어 있지 않습니다.');
    this.name = 'WhisperNotInstalledError';
  }
}

let activeChild: ChildProcess | null = null;

export function cancelActiveTranscription(): boolean {
  if (!activeChild) return false;
  try {
    activeChild.kill('SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/**
 * Cached binary detection. We re-check after 5 minutes in case the user
 * installs whisper while the app is open.
 */
let detectionCache: { at: number; result: TranscribeBinary | null } | null = null;
const DETECTION_TTL_MS = 5 * 60 * 1000;

export function detectWhisperBinary(force = false): TranscribeBinary | null {
  const now = Date.now();
  if (!force && detectionCache && now - detectionCache.at < DETECTION_TTL_MS) {
    return detectionCache.result;
  }
  const candidates: TranscribeBinary[] = [
    { kind: 'python-whisper', bin: 'whisper' },
    { kind: 'whisper-cpp', bin: 'whisper-cpp' },
    { kind: 'whisper-cpp', bin: 'whisper-cli' },
  ];
  for (const c of candidates) {
    if (probeBinary(c.bin)) {
      detectionCache = { at: now, result: c };
      return c;
    }
  }
  detectionCache = { at: now, result: null };
  return null;
}

function probeBinary(bin: string): boolean {
  try {
    const r = spawnSync(bin, ['--help'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 4000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

export async function transcribe(req: TranscribeRequest): Promise<TranscribeOk> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg 바이너리를 찾을 수 없습니다.');
  }
  const bin = detectWhisperBinary();
  if (!bin) {
    throw new WhisperNotInstalledError();
  }
  await fs.access(req.audioPath).catch(() => {
    throw new Error(`오디오 파일을 찾을 수 없습니다: ${req.audioPath}`);
  });

  const tempDir = await fs.mkdtemp(join(tmpdir(), 'whisper-'));
  try {
    // 1. Extract the selected audio range as 16kHz mono WAV (whisper's
    //    expected input format).
    const wavPath = join(tempDir, 'slice.wav');
    await runChild(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-ss', String(Math.max(0, req.startSec)),
      '-t', String(req.durationSec),
      '-i', req.audioPath,
      '-vn', '-ac', '1', '-ar', '16000',
      wavPath,
    ]);

    // 2. Run whisper. Output to a JSON file so we can parse cleanly.
    if (bin.kind === 'python-whisper') {
      return await runPythonWhisper(bin.bin, wavPath, tempDir, req.languageHint);
    }
    return await runWhisperCpp(bin.bin, wavPath, tempDir, req.languageHint);
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runPythonWhisper(
  bin: string,
  wavPath: string,
  tempDir: string,
  langHint?: LanguageCode | 'auto',
): Promise<TranscribeOk> {
  const args = [
    wavPath,
    '--model', 'tiny',
    '--output_format', 'json',
    '--output_dir', tempDir,
    '--verbose', 'False',
  ];
  if (langHint && langHint !== 'auto' && langHint !== 'unknown') {
    args.push('--language', langHint);
  }
  await runChild(bin, args);
  // Output filename is `<basename>.json`.
  const jsonPath = join(tempDir, 'slice.json');
  const raw = await fs.readFile(jsonPath, 'utf8').catch(() => '');
  if (!raw) throw new Error('Whisper 결과 파일을 읽을 수 없습니다.');
  const parsed = JSON.parse(raw) as {
    text?: string;
    language?: string;
    segments?: { start: number; end: number; text: string }[];
  };
  const lines = (parsed.segments ?? [])
    .map((s) => ({
      text: (s.text ?? '').trim(),
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
    }))
    .filter((l) => l.text.length > 0 && l.end > l.start);
  return {
    lines,
    rawText: (parsed.text ?? lines.map((l) => l.text).join('\n')).trim(),
    language: parsed.language ?? 'unknown',
  };
}

async function runWhisperCpp(
  bin: string,
  wavPath: string,
  tempDir: string,
  langHint?: LanguageCode | 'auto',
): Promise<TranscribeOk> {
  const outPrefix = join(tempDir, 'slice');
  const args = [
    '-m', 'models/ggml-tiny.bin', // user-installed; fallback to default search
    '-f', wavPath,
    '-of', outPrefix,
    '-oj', // JSON output
  ];
  if (langHint && langHint !== 'auto' && langHint !== 'unknown') {
    args.push('-l', langHint);
  }
  await runChild(bin, args);
  const jsonPath = `${outPrefix}.json`;
  const raw = await fs.readFile(jsonPath, 'utf8').catch(() => '');
  if (!raw) throw new Error('whisper.cpp 결과 파일을 읽을 수 없습니다.');
  const parsed = JSON.parse(raw) as {
    result?: { language?: string };
    transcription?: {
      offsets: { from: number; to: number };
      text: string;
    }[];
  };
  const lines = (parsed.transcription ?? [])
    .map((t) => ({
      text: (t.text ?? '').trim(),
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
    }))
    .filter((l) => l.text.length > 0 && l.end > l.start);
  return {
    lines,
    rawText: lines.map((l) => l.text).join('\n'),
    language: parsed.result?.language ?? 'unknown',
  };
}

function runChild(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    activeChild = child;
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (err) => {
      activeChild = null;
      reject(err);
    });
    child.on('close', (code, signal) => {
      activeChild = null;
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error('Whisper transcription cancelled.'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${bin} failed (exit ${code}). Last log:\n${stderr.slice(-1500)}`,
          ),
        );
      }
    });
  });
}

/** Convert TranscribedLine[] back to LyricLine[] used by the renderer. */
export function toLyricLines(transcribed: TranscribedLine[]): LyricLine[] {
  return transcribed.map((t) => ({
    text: t.text,
    start: t.start,
    end: t.end,
  }));
}
