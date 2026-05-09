import type { LanguageCode } from './types';

export interface LanguageDetection {
  language: LanguageCode;
  confidence: number; // 0..1
  scores: Record<LanguageCode, number>;
}

const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/g;
const HIRAGANA_RE = /[぀-ゟ]/g;
const KATAKANA_RE = /[゠-ヿ]/g;
const CJK_UNIFIED_RE = /[一-鿿㐀-䶿]/g;
const LATIN_RE = /[A-Za-z]/g;
const SPANISH_DIACRITIC_RE = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/g;
const HALF_WIDTH_KANA_RE = /[･-ﾟ]/g;

/**
 * Common Spanish stopwords/markers used to nudge English vs Spanish disambiguation.
 * Kept short and lowercased.
 */
const SPANISH_HINTS = [
  'el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'es',
  'por', 'con', 'para', 'su', 'del', 'al', 'lo', 'me', 'te', 'no', 'sí',
  'pero', 'mi', 'tu', 'eres', 'soy', 'esta', 'este', 'como', 'amor',
  'corazón', 'noche', 'siempre', 'nunca', 'porque', 'tambien', 'también',
];

const ENGLISH_HINTS = [
  'the', 'and', 'you', 'are', 'is', 'in', 'on', 'i', 'me', 'my', 'we',
  'love', 'never', 'always', 'baby', 'when', 'where', 'how', 'all', 'just',
  'like', 'don\'t', 'can\'t', 'won\'t', 'oh', 'yeah', 'tonight', 'feel',
];

function countMatches(str: string, re: RegExp): number {
  const m = str.match(re);
  return m ? m.length : 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{M}'’]+/u)
    .filter(Boolean);
}

function emptyScores(): Record<LanguageCode, number> {
  return { ko: 0, en: 0, ja: 0, zh: 0, es: 0, unknown: 0 };
}

/**
 * Detect the dominant language of a lyric body.
 *
 * Heuristic, not statistical: weighs script frequency (Hangul, Hiragana,
 * Katakana, CJK Unified) and word-level hints for English vs Spanish.
 * Designed to handle mixed-script inputs gracefully — short text or
 * inconclusive input returns `unknown`.
 */
export function detectLanguage(text: string): LanguageDetection {
  const trimmed = (text ?? '').trim();
  const scores = emptyScores();
  if (!trimmed) {
    return { language: 'unknown', confidence: 0, scores };
  }

  const hangul = countMatches(trimmed, HANGUL_RE);
  const hira = countMatches(trimmed, HIRAGANA_RE);
  const kata = countMatches(trimmed, KATAKANA_RE) + countMatches(trimmed, HALF_WIDTH_KANA_RE);
  const cjk = countMatches(trimmed, CJK_UNIFIED_RE);
  const latin = countMatches(trimmed, LATIN_RE);
  const spanishMarks = countMatches(trimmed, SPANISH_DIACRITIC_RE);

  const totalLetters = hangul + hira + kata + cjk + latin;
  if (totalLetters < 2) {
    return { language: 'unknown', confidence: 0, scores };
  }

  // Script-level scoring.
  scores.ko = hangul;
  scores.ja = hira + kata + (cjk > 0 && (hira + kata) > 0 ? Math.min(cjk, hira + kata) * 0.5 : 0);
  // Chinese is hanzi *without* significant kana presence.
  scores.zh = cjk > 0 && hira + kata === 0 ? cjk : Math.max(0, cjk - (hira + kata) * 2);
  scores.en = latin;
  scores.es = 0;

  // Disambiguate English vs Spanish on Latin-heavy text.
  if (latin > 0) {
    const tokens = tokenize(trimmed);
    let esHits = spanishMarks * 3;
    let enHits = 0;
    for (const tok of tokens) {
      if (SPANISH_HINTS.includes(tok)) esHits += 1;
      if (ENGLISH_HINTS.includes(tok)) enHits += 1;
    }
    // Apply hint deltas as a fraction of latin character count to keep scale
    // comparable to script-level scores.
    const total = enHits + esHits;
    if (total > 0) {
      const esRatio = esHits / total;
      scores.es = latin * esRatio;
      scores.en = latin * (1 - esRatio);
    } else if (spanishMarks > 0) {
      // Diacritics alone bias towards Spanish.
      scores.es = latin * 0.6;
      scores.en = latin * 0.4;
    }
  }

  // Pick the winner.
  const ranked = (Object.entries(scores) as [LanguageCode, number][])
    .filter(([k]) => k !== 'unknown')
    .sort((a, b) => b[1] - a[1]);

  const [topLang, topScore] = ranked[0];
  const [, secondScore] = ranked[1] ?? [undefined, 0];
  const sum = ranked.reduce((acc, [, v]) => acc + v, 0) || 1;
  const dominance = topScore / sum;
  const margin = topScore - secondScore;

  // Confidence threshold: require both meaningful dominance and a margin.
  if (topScore < 1 || dominance < 0.45 || margin < 1) {
    return { language: 'unknown', confidence: dominance, scores };
  }
  return { language: topLang, confidence: dominance, scores };
}

export const LANGUAGE_LABEL: Record<LanguageCode, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  unknown: 'Unknown',
};

/**
 * Per-language font stack hints — used to tweak overlay rendering so glyphs
 * pick fonts that include the right script. Values are CSS font-family lists.
 */
export const LANGUAGE_FONT_STACK: Record<LanguageCode, string> = {
  ko: '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  en: '"Inter", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  ja: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif',
  zh: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  es: '"Inter", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  unknown: '"Pretendard", "Noto Sans KR", system-ui, sans-serif',
};
