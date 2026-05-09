import type { LyricShortsAPI } from '../../shared/api';

declare global {
  interface Window {
    lyric: LyricShortsAPI;
  }
}

export const api = (): LyricShortsAPI => {
  if (!window.lyric) {
    throw new Error('Preload bridge not available. Are you running outside Electron?');
  }
  return window.lyric;
};
