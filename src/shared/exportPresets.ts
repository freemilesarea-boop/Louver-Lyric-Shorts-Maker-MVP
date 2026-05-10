import type { SafePlatform } from './safeZones';

/**
 * Export preset = bundle of ffmpeg encode parameters + filename suffix +
 * an optional safe-zone hint. The render engine itself is unchanged: only
 * the encode argv differs per preset.
 *
 * Frame size (1080×1920), fps (30), pixel format (yuv420p), and codecs
 * (libx264 / aac) are fixed across presets — those are platform-mandated
 * for vertical short-form video everywhere we target.
 */

export type ExportPresetKey =
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'tiktok'
  | 'high-quality';

export interface ExportPresetEncode {
  /** libx264 -preset. Trades encode speed for size at equal CRF. */
  videoPreset: 'ultrafast' | 'fast' | 'medium' | 'slow';
  /** libx264 -crf. Lower = better quality + bigger file. Sane range 17–28. */
  videoCrf: number;
  /** AAC bitrate in kbps. */
  audioBitrateKbps: number;
}

export interface ExportPresetDef {
  key: ExportPresetKey;
  label: string;
  description: string;
  /** Appended to nameTag — e.g. `_shorts`, `_reels`. Master uses `_master`. */
  filenameSuffix: string;
  encode: ExportPresetEncode;
  /**
   * Suggested safe-zone platform for this preset. Null = no platform-specific
   * safe zone (Master export). The UI uses this to auto-link the preview
   * safe-zone selector when the user changes preset.
   */
  safeZonePlatform: SafePlatform | null;
}

/**
 * The 4-preset registry. Tunings are calibrated against typical 9:16 lyric
 * shorts content (single image + text overlays, ~60% time average bitrate
 * dominated by text edges and amplitude pulses).
 */
export const EXPORT_PRESETS: Record<ExportPresetKey, ExportPresetDef> = {
  'youtube-shorts': {
    key: 'youtube-shorts',
    label: 'YouTube Shorts',
    description: '균형 잡힌 화질 / 파일 크기. 일반 업로드용.',
    filenameSuffix: '_shorts',
    encode: { videoPreset: 'medium', videoCrf: 22, audioBitrateKbps: 192 },
    safeZonePlatform: 'shorts',
  },
  'instagram-reels': {
    key: 'instagram-reels',
    label: 'Instagram Reels',
    description: '약간 높은 비트레이트로 모바일 압축에 강함.',
    filenameSuffix: '_reels',
    encode: { videoPreset: 'slow', videoCrf: 20, audioBitrateKbps: 256 },
    safeZonePlatform: 'reels',
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    description: '빠른 인코딩 / 가벼운 파일. 빠른 업로드용.',
    filenameSuffix: '_tiktok',
    encode: { videoPreset: 'fast', videoCrf: 24, audioBitrateKbps: 128 },
    safeZonePlatform: 'tiktok',
  },
  'high-quality': {
    key: 'high-quality',
    label: 'High Quality Master',
    description: '최소 압축 마스터. 보관 / 재인코딩 원본용 (파일 큼).',
    filenameSuffix: '_master',
    encode: { videoPreset: 'slow', videoCrf: 17, audioBitrateKbps: 320 },
    safeZonePlatform: null,
  },
};

export const EXPORT_PRESET_KEYS: ExportPresetKey[] = [
  'youtube-shorts',
  'instagram-reels',
  'tiktok',
  'high-quality',
];

export const DEFAULT_EXPORT_PRESET_KEY: ExportPresetKey = 'youtube-shorts';

export function getExportPreset(
  key: ExportPresetKey | null | undefined,
): ExportPresetDef {
  if (key && key in EXPORT_PRESETS) return EXPORT_PRESETS[key];
  return EXPORT_PRESETS[DEFAULT_EXPORT_PRESET_KEY];
}
