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
    name: 'K-Ballad Emotional',
    description: '소프트 핑크 톤 + 글로우 강조. 한글 가사 중심 발라드용.',
    templateId: 'soft-kpop-lyric',
    motionPreset: 'float_soft',
    animationPreset: 'soft_pop',
    reactiveMode: 'lyric_glow',
    cinematicFxPreset: 'soft_blur',
    recommendedLanguage: 'ko',
    lyricStyleHint: '한 줄당 짧고 감정적인 한글 가사 권장 (8~12자)',
  },
  {
    id: 'english-rnb-night',
    name: 'English R&B Night',
    description: '딥다크 + 시네마틱 블룸. 영문 슬로우잼 / R&B 무드.',
    templateId: 'dark-music-player',
    motionPreset: 'float_soft',
    animationPreset: 'blur_fade',
    reactiveMode: 'cinematic_bloom',
    cinematicFxPreset: 'subtle_bloom',
    recommendedLanguage: 'en',
    lyricStyleHint: '영문 4~6단어 라인. 줄간 띄어쓰기로 호흡 살리기',
  },
  {
    id: 'neon-drive-pop',
    name: 'Neon Drive Pop',
    description: '네온 글로우 + 박자 동기화. 신스팝 / 시티팝 무드.',
    templateId: 'neon-drive',
    motionPreset: 'slow_zoom_in',
    animationPreset: 'karaoke_glow',
    reactiveMode: 'neon_pulse',
    cinematicFxPreset: 'bloom_neon',
    recommendedLanguage: 'en',
    lyricStyleHint: '대문자 영문 또는 짧은 훅 라인이 잘 어울림',
  },
  {
    id: 'polaroid-love-song',
    name: 'Polaroid Love Song',
    description: '폴라로이드 보더 + 더스트/그레인. 어쿠스틱 러브송 무드.',
    templateId: 'polaroid-mood',
    motionPreset: 'slow_zoom_out',
    animationPreset: 'slide_down',
    reactiveMode: 'soft_pulse',
    cinematicFxPreset: 'dust_grain',
    recommendedLanguage: 'en',
    lyricStyleHint: '필기체 느낌의 짧은 영문/한글 가사 권장',
  },
  {
    id: 'vhs-indie-mood',
    name: 'VHS Indie Mood',
    description: 'VHS 노이즈 + 스캔라인 + 약한 RGB shift. 인디 록/시티팝.',
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
