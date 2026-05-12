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
 *
 * Phase 5-10.1 — also carries probe failure details when the binary
 * exists but won't run. Common Windows causes: Mark-of-the-Web stream
 * blocking SmartScreen, missing MSVC Runtime DLL, missing OpenBLAS DLL,
 * or the binary accidentally landed inside app.asar (where Windows
 * can't exec it directly). Each gets its own visible reason now.
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
  /** Phase 5-10.1 — exit code from the probe spawn. Undefined when we
   *  never spawned (binary missing). Negative when the process was
   *  killed by signal. */
  binProbeExitCode?: number;
  /** Phase 5-10.1 — last 800 chars of the probe's stderr. The Windows
   *  loader writes "The code execution cannot proceed because X.dll
   *  was not found" here when an MSVC / OpenBLAS dependency is missing
   *  — that's the actionable info the user needs. */
  binProbeStderr?: string;
  /** Phase 5-10.1 — true when the resolved binary path contains
   *  "app.asar". Should ALWAYS be false in production: extraResources
   *  unpacks it outside the asar archive. When true the packaging is
   *  broken — Windows can't exec a file that's inside a zip archive. */
  binInsideAsar: boolean;
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
  /** Phase 5-11 — loudness probe on the sliced WAV before whisper
   *  runs. Lets the renderer show a precise "오디오가 너무 조용해서
   *  가사를 인식할 수 없어요" message instead of the generic "failed
   *  to recognize" when the user picked a silent intro or a clip
   *  where the vocals are buried under instruments. */
  loudness?: {
    meanDb: number;
    maxDb: number;
    /** True when meanDb < -45 (essentially silent — whisper cannot
     *  reliably hear anything). */
    tooQuiet: boolean;
  };
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

  // Phase 5-10.1 — asar membership check. extraResources is supposed
  // to land the binary OUTSIDE app.asar (at process.resourcesPath/
  // whisper/...). If the path contains "app.asar" the packaging is
  // broken: Windows can't exec a file that lives inside a zip-style
  // archive. We flag this regardless of whether binFound is true so
  // the user / dev sees the structural problem.
  const binInsideAsar = expectedBinPath
    ? /app\.asar(?![.\\/])/i.test(expectedBinPath) ||
      /[\\/]app\.asar[\\/]/i.test(expectedBinPath)
    : false;

  // First probe.
  let probe = binFound
    ? probeBinaryDetailed(expectedBinPath!)
    : { ok: false };

  // Phase 5-10.1 — on Windows, attempt a one-shot Unblock-File if the
  // probe failed but the binary exists. Many Windows installers ship
  // executables with Mark-of-the-Web attached; PowerShell's
  // Unblock-File strips the alternate stream that SmartScreen / some
  // AV uses to block execution. We only attempt it once per
  // self-check call to avoid retry storms.
  if (
    binFound &&
    !probe.ok &&
    !binInsideAsar &&
    process.platform === 'win32' &&
    expectedBinPath
  ) {
    const dirName = expectedBinPath.replace(/[\\/][^\\/]+$/, '');
    tryUnblockOnWindows(dirName);
    probe = probeBinaryDetailed(expectedBinPath);
  }

  const binExecutable = probe.ok;
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
  // Sanity-check model size.
  if (ok && modelSizeBytes < 50 * 1024 * 1024) {
    ok = false;
  }
  if (ok && binInsideAsar) {
    ok = false;
  }

  let reason = '';
  if (binInsideAsar) {
    reason =
      `내장 AI 엔진이 app.asar 내부에 잘못 패키징되었어요 (${expectedBinPath}). ` +
      `extraResources / asarUnpack 설정이 누락된 빌드일 가능성이 큽니다. ` +
      `앱을 재설치하거나 개발자에게 알려주세요.`;
  } else if (!binFound) {
    reason =
      `내장 AI 엔진 실행 파일을 찾을 수 없어요 (${expectedBinPath ?? '(no path)'}). ` +
      `앱을 재설치하거나 패키징 단계의 fetch-whisper.sh가 실행됐는지 확인해주세요.`;
  } else if (!binExecutable) {
    // Phase 5-10.1 — name the actual loader error.
    const code = probe.exitCode;
    const errLine = (probe.stderrTail ?? '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
    const dllHint = /(\.dll|missing|not found|cannot|could not|VCRUNTIME|MSVCP)/i.test(
      errLine,
    );
    reason =
      `내장 AI 엔진은 있지만 실행에 실패했어요 (${expectedBinPath}). ` +
      `exit=${code ?? 'spawn-error'} ` +
      (errLine ? `stderr="${errLine.slice(0, 200)}" ` : '') +
      (dllHint
        ? '필요한 DLL 또는 Visual C++ Redistributable가 누락된 것 같아요. '
        : 'SmartScreen / 백신이 차단했거나 파일이 손상되었을 가능성이 있어요. ') +
      '문제가 계속되면 앱을 재설치해주세요.';
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
    binProbeExitCode: probe.exitCode,
    binProbeStderr: probe.stderrTail,
    binInsideAsar,
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
  return probeBinaryDetailed(bin).ok;
}

/**
 * Phase 5-10.1 — verbose probe. Captures spawnSync's exit code +
 * stderr tail so the self-check can report the actual loader error
 * (missing DLL, MOTW block, etc.) instead of a generic "not
 * executable".
 */
function probeBinaryDetailed(bin: string): {
  ok: boolean;
  exitCode?: number;
  signal?: NodeJS.Signals;
  stderrTail?: string;
  spawnError?: string;
} {
  try {
    const r = spawnSync(bin, ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 4000,
      windowsHide: true,
    });
    if (r.error) {
      return { ok: false, spawnError: r.error.message };
    }
    const stderrTail = (r.stderr?.toString('utf8') ?? '').slice(-800);
    return {
      ok: r.status === 0,
      exitCode: r.status ?? undefined,
      signal: (r.signal as NodeJS.Signals | null) ?? undefined,
      stderrTail,
    };
  } catch (e) {
    return { ok: false, spawnError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Phase 5-10.1 — Windows-only. When the bundled binary fails to run,
 * try stripping the Mark-of-the-Web stream that SmartScreen / AV uses
 * to block downloaded executables. The PowerShell `Unblock-File`
 * cmdlet does this; we wildcard it across the directory so the
 * companion DLLs get unblocked too. Best-effort: if PowerShell isn't
 * available the call exits silently and the existing diagnostic
 * still surfaces.
 */
function tryUnblockOnWindows(binDir: string): void {
  if (process.platform !== 'win32') return;
  try {
    const ps = 'powershell.exe';
    const cmd = `Get-ChildItem -Path "${binDir}" -Recurse -Include *.exe,*.dll | Unblock-File`;
    spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 4000,
      windowsHide: true,
    });
    // eslint-disable-next-line no-console
    console.log('[whisper:selfcheck] attempted Unblock-File on', binDir);
  } catch {
    // ignore — best-effort
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

    // Phase 5-11 — loudness probe. Runs a quick volumedetect pass
    // BEFORE whisper so we can attribute "no segments recognized"
    // to the right cause: a near-silent clip (intro / outro / wrong
    // range) vs. a noisy clip whisper just can't transcribe. Adds
    // ~150ms; ffmpeg is already warm. Failures fall through.
    const loudness = await probeLoudness(wavPath);
    // eslint-disable-next-line no-console
    console.log(
      '[whisper:loudness]',
      'meanDb=', loudness?.meanDb?.toFixed(1) ?? '(probe-failed)',
      'maxDb=', loudness?.maxDb?.toFixed(1) ?? '(probe-failed)',
      'tooQuiet=', loudness?.tooQuiet ?? false,
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
    const inner =
      bin.kind === 'python-whisper'
        ? await runPythonWhisper(bin.bin, wavPath, tempDir, req.languageHint)
        : await runWhisperCpp(bin.bin, wavPath, tempDir, req.languageHint);
    // Phase 5-11 — attach the loudness probe so the renderer can
    // distinguish "no segments because clip is silent" from "no
    // segments because whisper failed."
    return loudness ? { ...inner, loudness } : inner;
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

/**
 * Phase 5-11 — run `ffmpeg -af volumedetect` on the sliced WAV and
 * parse the `mean_volume:` / `max_volume:` dB lines from stderr.
 *
 * Returns `null` if the probe fails for any reason (ffmpeg missing,
 * parse error, etc.) — silent-audio detection is best-effort and
 * must never block the whisper run.
 *
 * `tooQuiet` threshold (-45 dB mean) chosen by inspection of real
 * silent intros vs. real-music clips: 5s of pure ambient room noise
 * registers ~-55 to -60 dB, a quiet acoustic intro ~-30, normal
 * pop vocal mix ~-15 to -20. -45 cleanly separates "actually
 * silent" from "vocals present but quiet."
 */
async function probeLoudness(
  wavPath: string,
): Promise<TranscribeOk['loudness'] | null> {
  if (!ffmpegPath) return null;
  return new Promise((resolve) => {
    const child = spawn(
      ffmpegPath!,
      ['-v', 'info', '-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'],
      { windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 32000) stderr = stderr.slice(-32000);
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      if (!meanMatch || !maxMatch) return resolve(null);
      const meanDb = parseFloat(meanMatch[1]);
      const maxDb = parseFloat(maxMatch[1]);
      if (!Number.isFinite(meanDb) || !Number.isFinite(maxDb)) return resolve(null);
      resolve({ meanDb, maxDb, tooQuiet: meanDb < -45 });
    });
  });
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
