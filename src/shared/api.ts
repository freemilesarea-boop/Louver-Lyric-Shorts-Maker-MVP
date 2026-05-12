import type {
  AmplitudeCurve,
  AnimationPreset,
  AudioMeta,
  CustomPreset,
  FxPreset,
  LanguageCode,
  LayoutOverrides,
  LyricLine,
  MotionPreset,
  ReactiveMode,
  RenderProgress,
  RenderRequest,
  RenderResult,
  StyleOverrides,
} from './types';

export interface CustomPresetSaveInput {
  name: string;
  templateId: string;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  cinematicFxPreset: FxPreset;
  language: LanguageCode | null;
  styleOverrides?: StyleOverrides;
  layoutOverrides?: LayoutOverrides;
  forceOverwrite?: boolean;
}

export interface CustomPresetSaveReply {
  ok: boolean;
  preset?: CustomPreset;
  conflict?: boolean;
  existingId?: string;
  error?: string;
}

export interface TranscribeRequest {
  audioPath: string;
  startSec: number;
  durationSec: number;
  languageHint?: LanguageCode | 'auto';
}

export interface TranscribeReply {
  ok: boolean;
  lines?: LyricLine[];
  language?: string;
  error?: string;
  notInstalled?: boolean;
  /** Phase 5-11 — loudness probe on the sliced clip. Renderer uses
   *  `tooQuiet=true` + empty lines to show "오디오가 너무 조용해요"
   *  instead of the generic "가사를 인식하지 못했어요". */
  loudness?: { meanDb: number; maxDb: number; tooQuiet: boolean };
}

/** Phase 5-8.1 — shape mirrors src/main/ipc/mediaProbe.ts MediaProbe. */
export interface MediaProbeInfo {
  format: string;
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  durationSec: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
}

export interface MediaProbeReply {
  probe: MediaProbeInfo;
  supported: boolean;
  reason: string;
}

export type TranscodeReply =
  | { ok: true; outputPath: string }
  | { ok: false; error: string };

export interface WhisperSelfCheckInfo {
  ok: boolean;
  expectedBinPath: string | null;
  binFound: boolean;
  binExecutable: boolean;
  /** Phase 5-10.1 — probe spawn exit code (e.g. Windows loader errors:
   *  -1073741515 / 0xC0000135 = ERROR_DLL_NOT_FOUND). undefined when
   *  the binary couldn't even be spawned (file missing, permissions). */
  binProbeExitCode?: number;
  /** Last 800 chars of the probe's stderr — contains the actual
   *  Windows loader error message for DLL-not-found cases. */
  binProbeStderr?: string;
  /** Phase 5-10.1 — true if the resolved binary path points inside
   *  app.asar. Always false in a correctly-packaged build. */
  binInsideAsar: boolean;
  expectedModelPath: string | null;
  modelFound: boolean;
  modelSizeBytes: number;
  reason: string;
}

export interface WhisperAvailability {
  ok: boolean;
  kind?: 'python-whisper' | 'whisper-cpp';
  /** Phase 5-10 — structured per-prerequisite check. The renderer
   *  uses this to render a precise "어떤 파일이 빠졌어요" banner. */
  selfCheck?: WhisperSelfCheckInfo;
}

export interface BundledFontVariant {
  weight: number;
  style: 'normal' | 'italic';
  /** base64-encoded font bytes; empty when the file isn't on disk. */
  base64: string;
  filename: string;
  loaded: boolean;
}

export interface BundledFontPayload {
  /** Mirrors `FontKey` from shared/fonts.ts. Kept as a string here so the
   *  preload doesn't pull the registry into the renderer's preload bundle. */
  key: string;
  family: string;
  variants: BundledFontVariant[];
}

export interface LyricShortsAPI {
  pickImage(): Promise<string | null>;
  pickAudio(): Promise<string | null>;
  pickOutputDir(): Promise<string | null>;
  defaultOutputDir(): Promise<string>;
  probeAudio(path: string): Promise<AudioMeta>;
  analyzeAmplitude(path: string, startSec: number, durationSec: number): Promise<AmplitudeCurve>;
  whisperAvailable(): Promise<WhisperAvailability>;
  transcribe(req: TranscribeRequest): Promise<TranscribeReply>;
  cancelTranscribe(): Promise<boolean>;

  listCustomPresets(): Promise<CustomPreset[]>;
  saveCustomPreset(input: CustomPresetSaveInput): Promise<CustomPresetSaveReply>;
  deleteCustomPreset(id: string): Promise<{ ok: boolean }>;

  loadBundledFonts(): Promise<BundledFontPayload[]>;
  /** Image-only, ≤10MB. Throws for gif/video/audio or oversized files;
   *  callers should fall back to {@link toMediaUrl} for those. */
  readAsDataURL(path: string): Promise<string>;
  /** Returns a `media://` URL backed by the privileged Electron protocol.
   *  Safe for arbitrary file sizes — streamed, not buffered. */
  toMediaUrl(path: string): Promise<string>;
  /** Phase 5-8.6 — direct `file://` URL. Use this for <video> / <audio>
   *  src; the media:// streaming bridge proved unreliable for video
   *  decode. webSecurity=false in the BrowserWindow allows file:// to
   *  load from the renderer. */
  toFileUrl(path: string): Promise<string>;
  /** Phase 5-8.1 — ffprobe the file and report whether Chromium's
   *  <video> will accept it for preview. Used by the validation
   *  banner to decide between "go straight to preview" and "offer
   *  transcode". */
  probeMedia(path: string): Promise<MediaProbeReply>;
  /** Phase 5-8.1 — transcode an unsupported source into a
   *  preview-friendly libx264 / yuv420p / -an MP4 under the OS temp
   *  dir. Progress events on `onTranscodeProgress`. */
  transcodeMainMedia(path: string): Promise<TranscodeReply>;
  onTranscodeProgress(cb: (p: { percent: number }) => void): () => void;
  fileExists(path: string): Promise<boolean>;
  basename(path: string): Promise<string>;

  startRender(req: RenderRequest): Promise<RenderResult>;
  cancelRender(): Promise<boolean>;
  onRenderProgress(cb: (p: RenderProgress) => void): () => void;

  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  // Phase 5-11 — diagnostics
  logPath(): Promise<string>;
  openLogFolder(): Promise<void>;
  copyDiagnostics(): Promise<{ ok: boolean; bytes: number }>;

  // Phase 5-11 — auto-updater
  updaterCheck(): Promise<UpdaterEventInfo>;
  updaterQuitAndInstall(): Promise<void>;
  onUpdaterEvent(cb: (e: UpdaterEventInfo) => void): () => void;
}

/** Mirrors src/main/autoUpdater.ts UpdaterEvent. */
export interface UpdaterEventInfo {
  kind:
    | 'checking'
    | 'update-available'
    | 'update-not-available'
    | 'download-progress'
    | 'update-downloaded'
    | 'error';
  version?: string;
  releaseNotes?: string | null;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}
