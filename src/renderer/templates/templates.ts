import type { Template } from '../../shared/types';

/**
 * MVP ships with 3 fully-tuned templates. The remaining 7 are scaffolded with
 * sensible defaults so the gallery is populated from day one — they can be
 * iterated on without touching render code.
 */

const minimalWhite: Template = {
  id: 'minimal-white',
  name: 'Minimal White',
  description: '깨끗한 흰 배경 카드 위 검정 가사',
  fontFamily: 'Pretendard',
  fontSize: 60,
  fontWeight: 700,
  lyricPosition: 'bottom',
  lyricColor: '#111111',
  lyricSubColor: '#FFB300',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: false,
  progressBarStyle: 'thin',
  backgroundEffect: 'blur',
  animationStyle: 'fade',
  cardBg: '#FFFFFF',
  overlayOpacity: 0.85,
};

const darkMusicPlayer: Template = {
  id: 'dark-music-player',
  name: 'Dark Music Player',
  description: '어두운 배경 + 진한 자막 + 재생 컨트롤',
  fontFamily: 'Pretendard',
  fontSize: 56,
  fontWeight: 600,
  lyricPosition: 'bottom',
  lyricColor: '#FFFFFF',
  lyricSubColor: '#FFD60A',
  lyricAlign: 'center',
  showPlayerControl: true,
  showWaveform: false,
  progressBarStyle: 'rounded',
  backgroundEffect: 'darken',
  animationStyle: 'slide',
  cardBg: '#0a0a0c',
  overlayOpacity: 0.55,
};

const polaroidMood: Template = {
  id: 'polaroid-mood',
  name: 'Polaroid Mood',
  description: '폴라로이드 감성 + 페이크 웨이브폼',
  fontFamily: 'Pretendard',
  fontSize: 50,
  fontWeight: 500,
  lyricPosition: 'top',
  lyricColor: '#1A1A1A',
  lyricSubColor: '#E76F51',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: true,
  progressBarStyle: 'none',
  backgroundEffect: 'sepia',
  animationStyle: 'none',
  cardBg: '#F5EFE0',
  overlayOpacity: 0.4,
};

const spotifyInspired: Template = {
  id: 'spotify-inspired',
  name: 'Spotify Inspired',
  description: '음악 스트리밍 느낌의 미니멀 컨트롤 (자체 디자인)',
  fontFamily: 'Pretendard',
  fontSize: 54,
  fontWeight: 700,
  lyricPosition: 'bottom',
  lyricColor: '#FFFFFF',
  lyricSubColor: '#1DB954',
  lyricAlign: 'left',
  showPlayerControl: true,
  showWaveform: false,
  progressBarStyle: 'thin',
  backgroundEffect: 'darken',
  animationStyle: 'fade',
  cardBg: '#121212',
  overlayOpacity: 0.6,
};

const appleMusicInspired: Template = {
  id: 'apple-music-inspired',
  name: 'Apple Music Inspired',
  description: '컬러 풀스크린 + 큰 타이포 (자체 디자인)',
  fontFamily: 'Pretendard',
  fontSize: 64,
  fontWeight: 800,
  lyricPosition: 'bottom',
  lyricColor: '#FFFFFF',
  lyricSubColor: '#FF2D55',
  lyricAlign: 'left',
  showPlayerControl: false,
  showWaveform: false,
  progressBarStyle: 'thick',
  backgroundEffect: 'none',
  animationStyle: 'slide',
  cardBg: '#000000',
  overlayOpacity: 0.35,
};

const youtubeMusicInspired: Template = {
  id: 'youtube-music-inspired',
  name: 'YouTube Music Inspired',
  description: '레드 액센트 + 깔끔한 카드 (자체 디자인)',
  fontFamily: 'Pretendard',
  fontSize: 52,
  fontWeight: 700,
  lyricPosition: 'center',
  lyricColor: '#FFFFFF',
  lyricSubColor: '#FF0033',
  lyricAlign: 'center',
  showPlayerControl: true,
  showWaveform: true,
  progressBarStyle: 'rounded',
  backgroundEffect: 'darken',
  animationStyle: 'fade',
  cardBg: '#0f0f0f',
  overlayOpacity: 0.55,
};

const cassetteTape: Template = {
  id: 'cassette-tape',
  name: 'Cassette Tape',
  description: '레트로 카세트 감성',
  fontFamily: 'Pretendard',
  fontSize: 48,
  fontWeight: 700,
  lyricPosition: 'center',
  lyricColor: '#FFEFC8',
  lyricSubColor: '#FF6F61',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: true,
  progressBarStyle: 'thick',
  backgroundEffect: 'sepia',
  animationStyle: 'none',
  cardBg: '#3b2a1a',
  overlayOpacity: 0.5,
};

const vhsNight: Template = {
  id: 'vhs-night',
  name: 'VHS Night',
  description: '심야 VHS 노이즈 무드',
  fontFamily: 'Pretendard',
  fontSize: 50,
  fontWeight: 700,
  lyricPosition: 'bottom',
  lyricColor: '#E0FFFF',
  lyricSubColor: '#FF66FF',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: true,
  progressBarStyle: 'thin',
  backgroundEffect: 'darken',
  animationStyle: 'fade',
  cardBg: '#0a0014',
  overlayOpacity: 0.6,
};

const softKpopLyric: Template = {
  id: 'soft-kpop-lyric',
  name: 'Soft K-Pop Lyric',
  description: '파스텔 무드 + 한국어 강조',
  fontFamily: 'Pretendard',
  fontSize: 56,
  fontWeight: 600,
  lyricPosition: 'bottom',
  lyricColor: '#FFFFFF',
  lyricSubColor: '#FFD8E8',
  lyricAlign: 'center',
  showPlayerControl: false,
  showWaveform: false,
  progressBarStyle: 'thin',
  backgroundEffect: 'blur',
  animationStyle: 'fade',
  cardBg: '#FFB7C5',
  overlayOpacity: 0.5,
};

const neonDrive: Template = {
  id: 'neon-drive',
  name: 'Neon Drive',
  description: '네온 사이버펑크 무드',
  fontFamily: 'Pretendard',
  fontSize: 56,
  fontWeight: 800,
  lyricPosition: 'center',
  lyricColor: '#00FFD1',
  lyricSubColor: '#FF00C8',
  lyricAlign: 'center',
  showPlayerControl: true,
  showWaveform: true,
  progressBarStyle: 'rounded',
  backgroundEffect: 'darken',
  animationStyle: 'slide',
  cardBg: '#06061a',
  overlayOpacity: 0.65,
};

export const templates: Template[] = [
  minimalWhite,
  darkMusicPlayer,
  polaroidMood,
  spotifyInspired,
  appleMusicInspired,
  youtubeMusicInspired,
  cassetteTape,
  vhsNight,
  softKpopLyric,
  neonDrive,
];

/** The 3 templates that are wired in for the first MVP milestone. */
export const mvpReadyTemplateIds = new Set<string>([
  'minimal-white',
  'dark-music-player',
  'polaroid-mood',
]);

export function getTemplate(id: string): Template {
  return templates.find((t) => t.id === id) ?? templates[0];
}
