import type {
  AmplitudeCurve,
  AudioMeta,
  RenderProgress,
  RenderRequest,
  RenderResult,
} from './types';

export interface LyricShortsAPI {
  pickImage(): Promise<string | null>;
  pickAudio(): Promise<string | null>;
  pickOutputDir(): Promise<string | null>;
  defaultOutputDir(): Promise<string>;
  probeAudio(path: string): Promise<AudioMeta>;
  analyzeAmplitude(path: string, startSec: number, durationSec: number): Promise<AmplitudeCurve>;
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
