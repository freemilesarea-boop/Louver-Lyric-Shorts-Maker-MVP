import type {
  AmplitudeCurve,
  AnimationPreset,
  AudioMeta,
  CustomPreset,
  FxPreset,
  LanguageCode,
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
}

export interface WhisperAvailability {
  ok: boolean;
  kind?: 'python-whisper' | 'whisper-cpp';
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
  readAsDataURL(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  basename(path: string): Promise<string>;

  startRender(req: RenderRequest): Promise<RenderResult>;
  cancelRender(): Promise<boolean>;
  onRenderProgress(cb: (p: RenderProgress) => void): () => void;

  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
