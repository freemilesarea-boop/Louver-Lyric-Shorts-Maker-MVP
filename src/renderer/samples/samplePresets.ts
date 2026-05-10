import type {
  AnimationPreset,
  FxPreset,
  LanguageCode,
  MotionPreset,
  ReactiveMode,
} from '../../shared/types';

/**
 * A SamplePreset bundles a complete look — template + motion + animation +
 * reactive + FX + language hint — that's known to work well together. The
 * editor exposes these as one-click "starting points" so a user can
 * audition a vibe without learning every selector.
 */
export interface SamplePreset {
  id: string;
  name: string;
  description: string;
  templateId: string;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  cinematicFxPreset: FxPreset;
  recommendedLanguage: LanguageCode;
  /** Free-form hint shown next to the preset (UI copy only). */
  lyricStyleHint: string;
}

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'k-ballad-emotional',
    name: '한국 발라드 감성',
    description: '부드러운 핑크 톤과 글로우. 한글 가사 발라드에 어울려요.',
    templateId: 'soft-kpop-lyric',
    motionPreset: 'float_soft',
    animationPreset: 'soft_pop',
    reactiveMode: 'lyric_glow',
    cinematicFxPreset: 'soft_blur',
    recommendedLanguage: 'ko',
    lyricStyleHint: '한 줄에 짧고 감정적인 한글 (8~12자) 권장',
  },
  {
    id: 'english-rnb-night',
    name: '영문 R&B 야간',
    description: '진한 어둠과 시네마틱 빛 번짐. 영문 R&B / 슬로우잼.',
    templateId: 'dark-music-player',
    motionPreset: 'float_soft',
    animationPreset: 'blur_fade',
    reactiveMode: 'cinematic_bloom',
    cinematicFxPreset: 'subtle_bloom',
    recommendedLanguage: 'en',
    lyricStyleHint: '영문 4~6단어. 줄 사이 한 칸으로 호흡',
  },
  {
    id: 'neon-drive-pop',
    name: '네온 드라이브 팝',
    description: '네온 글로우와 박자 동기화. 신스팝 / 시티팝.',
    templateId: 'neon-drive',
    motionPreset: 'slow_zoom_in',
    animationPreset: 'karaoke_glow',
    reactiveMode: 'neon_pulse',
    cinematicFxPreset: 'bloom_neon',
    recommendedLanguage: 'en',
    lyricStyleHint: '대문자 영문 또는 짧은 훅 라인 권장',
  },
  {
    id: 'polaroid-love-song',
    name: '폴라로이드 러브송',
    description: '폴라로이드 테두리와 먼지/그레인. 어쿠스틱 러브송.',
    templateId: 'polaroid-mood',
    motionPreset: 'slow_zoom_out',
    animationPreset: 'slide_down',
    reactiveMode: 'soft_pulse',
    cinematicFxPreset: 'dust_grain',
    recommendedLanguage: 'en',
    lyricStyleHint: '필기체 느낌의 짧은 가사 권장',
  },
  {
    id: 'vhs-indie-mood',
    name: 'VHS 인디 무드',
    description: 'VHS 노이즈와 스캔라인. 인디 록 / 시티팝.',
    templateId: 'vhs-night',
    motionPreset: 'pan_right',
    animationPreset: 'blur_fade',
    reactiveMode: 'cinematic_bloom',
    cinematicFxPreset: 'aberration_grain',
    recommendedLanguage: 'en',
    lyricStyleHint: '레트로 분위기의 짧은 한 줄, 두 줄 권장',
  },
];

export function getSamplePreset(id: string): SamplePreset | undefined {
  return SAMPLE_PRESETS.find((p) => p.id === id);
}
