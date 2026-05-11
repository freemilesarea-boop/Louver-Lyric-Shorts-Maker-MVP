import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../render/binaries';
import type { LanguageCode, LyricLine } from '../../shared/types';
import { app } from 'electron';

/**
 * Whisper transcription support.
 *
 * Phase 5-10 — fully self-contained. The detection chain now uses ONLY
 * the bundled whisper-cli binary that ships in the installer at
 * `resources/whisper/bin/<platform>/whisper-cli[.exe]`. PATH fallback
 * has been removed because the user explicitly required no external
 * dependencies (no Python, no system whisper, no PATH config). End
 * users open the app and AI 가사 추출 just works — or it doesn't,
 * and the failure reason names which bundled file is missing /
 * corrupt so the user knows whether to reinstall.
 *
 * Detection order (Phase 5-10):
 *   1. **Bundled** whisper-cli at process.resourcesPath/whisper/bin/...
 *      — shipped with the app. If executable AND the ggml model is
 *      on disk → use it.
 *   2. Fail with a precise reason (no-binary / no-model / not-
 *      executable). NO PATH fallback. NO "install Python whisper"
 *      message.
 *
 * Audio is sliced by ffmpeg first so whisper only sees the user's
 * selected clip range. Timestamps come back clip-relative (0..durSec).
 */

export type TranscribeBinary =
  | { kind: 'python-whisper'; bin: string }
  | { kind: 'whisper-cpp'; bin: string };

/**
 * Phase 5-10 — structured self-check result. Returned by
 * detectWhisperSelfCheck (and the audio:whisperAvailable IPC) so the
 * renderer can show a precise "어떤 파일이 빠졌는지" banner instead
 * of a generic "Whisper가 없어요" message.
 */
export interface WhisperSelfCheck {
  /** Final verdict — true only when binary + model are both usable. */
  ok: boolean;
  /** Resolved bundled binary path, even if it doesn't exist on disk. */
  expectedBinPath: string | null;
  /** True when the binary file exists at the expected path. */
  binFound: boolean;
  /** True when `bin --help` exited 0 (file exists + is executable). */
  binExecutable: boolean;
  /** Resolved bundled model path, even if absent. */
  expectedModelPath: string | null;
  /** True when the model file exists. */
  modelFound: boolean;
  /** Model file size in bytes when present (sanity check — ggml-base
   *  should be ~140 MB, ggml-tiny ~75 MB). 0 when absent. */
  modelSizeBytes: number;
  /** When ok=false, a friendly Korean explanation. */
  reason: string;
}

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
  /** Phase 5-10: the structured self-check that produced this error.
   *  Renderer reads it to render a precise "어떤 파일이 빠졌어요"
   *  message instead of a generic "Whisper가 없어요". */
  selfCheck?: WhisperSelfCheck;
  constructor(selfCheck?: WhisperSelfCheck) {
    super(
      selfCheck?.reason
        ?? '내장 AI 엔진을 찾을 수 없어요. 앱을 재설치하거나 패키징 단계가 끝났는지 확인해주세요.',
    );
    this.name = 'WhisperNotInstalledError';
    this.selfCheck = selfCheck;
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

  // Phase 5-10: bundled-only. No PATH fallback. If the binary isn't
  // shipped in the installer, AI 가사 추출 is disabled — period. The
  // user installs / reinstalls / repackages; we never tell them to
  // pip install something.
  const bundled = bundledWhisperPath();
  if (bundled && existsSync(bundled) && probeBinary(bundled)) {
    const result: TranscribeBinary = { kind: 'whisper-cpp', bin: bundled };
    detectionCache = { at: now, result };
    return result;
  }
  detectionCache = { at: now, result: null };
  return null;
}

/**
 * Phase 5-10 — structured self-check. Resolves each prerequisite
 * separately so the renderer (and the boot-time log) can identify
 * which specific file is missing or broken.
 *
 * Cached for 5 minutes alongside detectWhisperBinary so calling
 * detectWhisperSelfCheck() during transcribe doesn't redo any work.
 */
export function detectWhisperSelfCheck(force = false): WhisperSelfCheck {
  const expectedBinPath = bundledWhisperPath();
  const expectedModelPath = bundledWhisperModelPath();
  const binFound = expectedBinPath != null && existsSync(expectedBinPath);
  const binExecutable = binFound ? probeBinary(expectedBinPath!) : false;
  const modelFound = expectedModelPath != null && existsSync(expectedModelPath);
  let modelSizeBytes = 0;
  if (modelFound && expectedModelPath) {
    try {
      modelSizeBytes = require('node:fs').statSync(expectedModelPath).size;
    } catch {
      modelSizeBytes = 0;
    }
  }
  // Prime the binary cache so the next transcribe() call doesn't
  // re-probe the same file.
  if (force) detectWhisperBinary(true);

  let ok = binFound && binExecutable && modelFound;
  // Sanity-check model size — ggml-tiny is ~75 MB, ggml-base ~140 MB.
  // Anything smaller than 50 MB is almost certainly truncated.
  if (ok && modelSizeBytes < 50 * 1024 * 1024) {
    ok = false;
  }
  let reason = '';
  if (!binFound) {
    reason =
      `내장 AI 엔진 실행 파일을 찾을 수 없어요 (${expectedBinPath ?? '(no path)'}). ` +
      `앱을 재설치하거나 패키징 단계의 fetch-whisper.sh가 실행됐는지 확인해주세요.`;
  } else if (!binExecutable) {
    reason =
      `내장 AI 엔진은 있지만 실행할 수 없어요 (${expectedBinPath}). ` +
      `파일 권한 또는 백신/Gatekeeper가 차단하지 않았는지 확인해주세요.`;
  } else if (!modelFound) {
    reason =
      `AI 엔진은 있지만 모델 파일이 빠져 있어요 (${expectedModelPath ?? '(no model path)'}). ` +
      `앱을 재설치해주세요.`;
  } else if (modelSizeBytes < 50 * 1024 * 1024) {
    reason =
      `모델 파일이 손상된 것 같아요 (${modelSizeBytes} bytes). ` +
      `정상 크기는 75 MB(tiny) 또는 140 MB(base) 이상입니다.`;
  }

  return {
    ok,
    expectedBinPath,
    binFound,
    binExecutable,
    expectedModelPath,
    modelFound,
    modelSizeBytes,
    reason,
  };
}

/**
 * Path the bundled whisper-cli is expected to live at when packaged. The
 * binary is shipped per host OS via electron-builder's `extraResources`
 * (see package.json + README §"Whisper bundling"). Returns null if we're
 * not running in Electron / the resource path isn't set.
 *
 * Layout:
 *   <resources>/whisper/bin/<platform>/whisper-cli[.exe]
 *
 * <platform> ∈ {darwin-arm64, darwin-x64, linux-x64, win32-x64}.
 */
function bundledWhisperPath(): string | null {
  let resourcesPath: string | null = null;
  try {
    if (app && app.isPackaged) {
      // process.resourcesPath is set by Electron in packaged builds.
      resourcesPath = process.resourcesPath ?? null;
    } else {
      // Dev: the bundle lives under the repo's resources/ if the user
      // pre-fetched it (build script puts it there). Optional in dev.
      resourcesPath = join(process.cwd(), 'resources');
    }
  } catch {
    return null;
  }
  if (!resourcesPath) return null;
  const platformKey = (() => {
    if (process.platform === 'darwin') {
      return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    }
    if (process.platform === 'win32') return 'win32-x64';
    if (process.platform === 'linux') return 'linux-x64';
    return null;
  })();
  if (!platformKey) return null;
  const binName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  return join(resourcesPath, 'whisper', 'bin', platformKey, binName);
}

/**
 * Default model path for the bundled whisper-cli. The binary needs to be
 * told where the ggml model file lives via `-m`. We ship one model under
 * resources/whisper/models/ and pass its path automatically.
 */
export function bundledWhisperModelPath(): string | null {
  let resourcesPath: string | null = null;
  try {
    resourcesPath = app && app.isPackaged
      ? (process.resourcesPath ?? null)
      : join(process.cwd(), 'resources');
  } catch {
    return null;
  }
  if (!resourcesPath) return null;
  const candidates = ['ggml-base.bin', 'ggml-tiny.bin'];
  for (const name of candidates) {
    const p = join(resourcesPath, 'whisper', 'models', name);
    if (existsSync(p)) return p;
  }
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
    // Surface a precise reason via the structured self-check so the
    // renderer banner can tell the user EXACTLY which file is the
    // problem (missing binary vs missing model vs not executable).
    throw new WhisperNotInstalledError(detectWhisperSelfCheck());
  }
  await fs.access(req.audioPath).catch(() => {
    throw new Error(`오디오 파일을 찾을 수 없습니다: ${req.audioPath}`);
  });

  const wavPathLog = await debugWavDirIfRequested();
  // eslint-disable-next-line no-console
  console.log(
    '[whisper:detect]',
    'kind=', bin.kind,
    'bin=', bin.bin,
    'model=', bin.kind === 'whisper-cpp'
      ? (bundledWhisperModelPath() ?? 'models/ggml-base.bin')
      : '(python whisper resolves model internally — see --model flag)',
    'modelName=', deriveModelName(bin),
    'language=', req.languageHint ?? '(unset)',
    'startSec=', req.startSec,
    'durationSec=', req.durationSec,
    'audioPath=', req.audioPath,
    'debugWavExport=', wavPathLog ?? '(disabled — set LSM_WHISPER_KEEP_WAV=1 to enable)',
  );

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
    const wavStat = await fs.stat(wavPath).catch(() => null);
    // eslint-disable-next-line no-console
    console.log(
      '[whisper:input]',
      'wavPath=', wavPath,
      'sizeBytes=', wavStat?.size ?? 0,
      'expectedSec=', req.durationSec,
    );

    // Optionally export the slice wav so the user can play it back to
    // verify the audio Whisper actually heard. Controlled by env var
    // to keep production runs from littering temp.
    if (wavPathLog && wavStat) {
      try {
        await fs.copyFile(wavPath, wavPathLog);
        // eslint-disable-next-line no-console
        console.log('[whisper:input] debug wav saved →', wavPathLog);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[whisper:input] debug wav copy failed:', e);
      }
    }

    // 2. Run whisper. Output to a JSON file so we can parse cleanly.
    if (bin.kind === 'python-whisper') {
      return await runPythonWhisper(bin.bin, wavPath, tempDir, req.languageHint);
    }
    return await runWhisperCpp(bin.bin, wavPath, tempDir, req.languageHint);
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Phase 5-9 — when LSM_WHISPER_KEEP_WAV=1 is set, write the slice wav
 * to a known location under the OS temp dir so the user can open it in
 * QuickTime / VLC and verify Whisper actually got intelligible audio.
 * The filename includes a timestamp so successive runs don't clobber
 * each other. Returns the destination path or null when disabled.
 */
async function debugWavDirIfRequested(): Promise<string | null> {
  if (process.env['LSM_WHISPER_KEEP_WAV'] !== '1') return null;
  let root: string;
  try {
    root = app && app.getPath ? app.getPath('temp') : tmpdir();
  } catch {
    root = tmpdir();
  }
  const dir = join(root, 'lyric-shorts-whisper-debug');
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `slice-${stamp}.wav`);
}

/** Best-effort model identity for the debug log. */
function deriveModelName(bin: TranscribeBinary): string {
  if (bin.kind === 'whisper-cpp') {
    const m = bundledWhisperModelPath();
    if (!m) return 'system whisper-cpp default (likely ggml-base.bin)';
    const base = m.split(/[/\\]/).pop() ?? m;
    return base.replace(/^ggml-/, '').replace(/\.bin$/, '');
  }
  return 'tiny (hard-coded in args; pass --model on the CLI to change)';
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
    // Phase 5-9 — VAD filter. openai-whisper's CLI doesn't expose a
    // built-in VAD toggle (the `--vad_filter` flag is faster-whisper's,
    // not openai-whisper's). Document the absence in the log instead
    // of pretending we set it.
  ];
  if (langHint && langHint !== 'auto' && langHint !== 'unknown') {
    args.push('--language', langHint);
  }
  // eslint-disable-next-line no-console
  console.log(
    '[whisper:args] python-whisper',
    'argv=', [bin, ...args].join(' '),
    'vad_filter=', '(not supported by openai-whisper CLI; faster-whisper only)',
    'languageFlag=', langHint && langHint !== 'auto' && langHint !== 'unknown' ? langHint : '(auto-detect)',
  );
  await runChild(bin, args);
  // Output filename is `<basename>.json`.
  const jsonPath = join(tempDir, 'slice.json');
  const raw = await fs.readFile(jsonPath, 'utf8').catch(() => '');
  if (!raw) throw new Error('Whisper 결과 파일을 읽을 수 없습니다.');
  const parsed = JSON.parse(raw) as {
    text?: string;
    language?: string;
    segments?: {
      start: number;
      end: number;
      text: string;
      avg_logprob?: number;
      no_speech_prob?: number;
      compression_ratio?: number;
    }[];
  };
  const segments = parsed.segments ?? [];
  const lines = segments
    .map((s) => ({
      text: (s.text ?? '').trim(),
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
    }))
    .filter((l) => l.text.length > 0 && l.end > l.start);
  const rawText = (parsed.text ?? lines.map((l) => l.text).join('\n')).trim();

  // eslint-disable-next-line no-console
  console.log(
    '[whisper:done] python-whisper',
    'detected_language=', parsed.language ?? 'unknown',
    'segments=', segments.length,
    'lines=', lines.length,
  );
  // eslint-disable-next-line no-console
  console.log('[whisper:raw]', JSON.stringify(rawText));
  // Per-segment confidence: openai-whisper publishes avg_logprob (lower
  // = less confident; > -1.0 is usually solid) + no_speech_prob (> 0.6
  // means likely silence) + compression_ratio (> 2.4 means likely
  // hallucinated repetition).
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    // eslint-disable-next-line no-console
    console.log(
      `[whisper:segment ${i}]`,
      't=', `${s.start?.toFixed(2)}~${s.end?.toFixed(2)}`,
      'avg_logprob=', s.avg_logprob?.toFixed(3) ?? 'n/a',
      'no_speech_prob=', s.no_speech_prob?.toFixed(3) ?? 'n/a',
      'compression_ratio=', s.compression_ratio?.toFixed(2) ?? 'n/a',
      'text=', JSON.stringify((s.text ?? '').trim().slice(0, 80)),
    );
  }
  return {
    lines,
    rawText,
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
  // Prefer the bundled model when present; fall back to whisper-cpp's
  // default search path (e.g. user's ~/.cache or models/ next to bin).
  const modelPath = bundledWhisperModelPath() ?? 'models/ggml-base.bin';
  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '-of', outPrefix,
    '-oj', // JSON output
  ];
  if (langHint && langHint !== 'auto' && langHint !== 'unknown') {
    args.push('-l', langHint);
  }
  // eslint-disable-next-line no-console
  console.log(
    '[whisper:args] whisper-cpp',
    'argv=', [bin, ...args].join(' '),
    'modelPath=', modelPath,
    'vad_filter=', '(whisper.cpp has no built-in VAD; pass --no-context for less hallucination)',
    'languageFlag=', langHint && langHint !== 'auto' && langHint !== 'unknown' ? langHint : '(auto-detect)',
  );
  await runChild(bin, args);
  const jsonPath = `${outPrefix}.json`;
  const raw = await fs.readFile(jsonPath, 'utf8').catch(() => '');
  if (!raw) throw new Error('whisper.cpp 결과 파일을 읽을 수 없습니다.');
  const parsed = JSON.parse(raw) as {
    result?: { language?: string };
    transcription?: {
      offsets: { from: number; to: number };
      text: string;
      // whisper.cpp doesn't ship per-segment confidence in the
      // default JSON output. Token-level info is available with
      // `--output-tokens` but parsing it is non-trivial.
    }[];
  };
  const transcription = parsed.transcription ?? [];
  const lines = transcription
    .map((t) => ({
      text: (t.text ?? '').trim(),
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
    }))
    .filter((l) => l.text.length > 0 && l.end > l.start);
  const rawText = lines.map((l) => l.text).join('\n');

  // eslint-disable-next-line no-console
  console.log(
    '[whisper:done] whisper-cpp',
    'detected_language=', parsed.result?.language ?? 'unknown',
    'segments=', transcription.length,
    'lines=', lines.length,
  );
  // eslint-disable-next-line no-console
  console.log('[whisper:raw]', JSON.stringify(rawText));
  for (let i = 0; i < transcription.length; i++) {
    const t = transcription[i];
    // eslint-disable-next-line no-console
    console.log(
      `[whisper:segment ${i}]`,
      't=', `${((t.offsets?.from ?? 0) / 1000).toFixed(2)}~${((t.offsets?.to ?? 0) / 1000).toFixed(2)}`,
      'confidence=', '(whisper.cpp JSON does not include per-segment confidence; rerun with --output-tokens for token-level logprobs)',
      'text=', JSON.stringify((t.text ?? '').trim().slice(0, 80)),
    );
  }
  return {
    lines,
    rawText,
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
