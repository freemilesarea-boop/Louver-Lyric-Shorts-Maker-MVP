export type LyricPosition = 'top' | 'center' | 'bottom';
export type LyricAlign = 'left' | 'center' | 'right';
export type ProgressBarStyle = 'none' | 'thin' | 'thick' | 'rounded';
export type BackgroundEffect = 'blur' | 'darken' | 'sepia' | 'none';
export type AnimationStyle = 'none' | 'fade' | 'slide';

export interface Template {
  id: string;
  name: string;
  description?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lyricPosition: LyricPosition;
  lyricColor: string;
  lyricSubColor: string;
  lyricAlign: LyricAlign;
  showPlayerControl: boolean;
  showWaveform: boolean;
  progressBarStyle: ProgressBarStyle;
  backgroundEffect: BackgroundEffect;
  animationStyle: AnimationStyle;
  cardBg: string;
  overlayOpacity: number;
}

export interface LyricLine {
  text: string;
  ko?: string;
  start?: number;
  end?: number;
}

export interface AudioMeta {
  durationSec: number;
}

export interface OverlayPng {
  /** PNG bytes encoded as base64 (no data URL prefix). */
  base64: string;
  startSec: number;
  endSec: number;
}

export interface RenderRequest {
  imagePath: string;
  audioPath: string;
  lyrics: LyricLine[];
  template: Template;
  startSec: number;
  durationSec: 15 | 30 | 60;
  trackTitle?: string;
  artistName?: string;
  highlightKorean: boolean;
  outputPath?: string;
  /**
   * Pre-rendered lyric/meta overlays. Each PNG must be the full output size
   * (1080×1920) with a transparent background. They are composited onto the
   * frame in order via the overlay filter, gated by [start,end] seconds.
   */
  overlays?: OverlayPng[];
}

export interface RenderProgress {
  jobId: string;
  percent: number;
  stage: 'preparing' | 'rendering' | 'finalizing' | 'done' | 'error';
  message?: string;
  outputPath?: string;
}

export interface RenderResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
}
