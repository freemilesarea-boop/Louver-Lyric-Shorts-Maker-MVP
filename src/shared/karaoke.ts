/**
 * Karaoke "lite" — approximate word-level progress within a lyric chunk.
 *
 * MODEL
 * =====
 * Given a chunk that lasts `chunkDur` seconds and contains N words, the
 * "active word" at clip-relative time `tInChunk` is simply
 *   floor((tInChunk / chunkDur) × N)
 *
 * That's it. No phoneme alignment, no Whisper word-time JSON parsing —
 * just elapsed-ratio. The visual treatment (color shift, glow, alpha
 * fade) is what sells the "follow along" feeling, not the timing
 * accuracy.
 *
 * TOKENIZATION
 * ============
 *   - Text with whitespace → split by whitespace (Latin scripts, Korean)
 *   - Text without whitespace → split by character (Japanese, Chinese)
 *
 * This file owns the painter too (`paintKaraokeText`) so scene.ts can
 * call one helper instead of reimplementing layout. The painter wraps
 * tokens to fit `maxWidth`, then draws each token with its
 * past/active/future style — same logic for preview canvas and export
 * PNG keyframes.
 */

/** Minimal shadow shape — kept local to avoid an import cycle with scene.ts. */
export interface KaraokeShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
  outline?: boolean;
}

// Hangul + Hiragana + Katakana + CJK Unified ranges.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

export function splitTokens(text: string): string[] {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];
  if (/\s/.test(trimmed)) {
    return trimmed.split(/\s+/);
  }
  // Single-token text. Only fall through to per-character splitting when
  // the text actually contains CJK glyphs (Japanese / Chinese without
  // spaces). Plain ASCII single words like "hello" stay as one token.
  if (CJK_RE.test(trimmed)) {
    return Array.from(trimmed);
  }
  return [trimmed];
}

export function activeWordIndex(progress: number, wordCount: number): number {
  if (wordCount <= 0) return -1;
  const p = clamp01(progress);
  return Math.min(wordCount - 1, Math.floor(p * wordCount));
}

export interface KaraokePaintOpts {
  text: string;
  /** Anchor x — interpreted as left/center/right based on textAlign. */
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  fontWeight: number;
  family: string;
  /** Color for past + future tokens (full alpha for past, dimmed for future). */
  baseColor: string;
  /** Color for the active token (usually lyricSubColor). */
  activeColor: string;
  /** Glow color for the active token (defaults to activeColor). */
  glowColor?: string;
  /** Glow intensity 0..1 — bigger blur for higher values. */
  glowAmount: number;
  shadow: KaraokeShadow;
  /** 0..1 progress through this chunk. */
  progress: number;
  /** True when text is whitespace-split (uses spaces in measurement). */
  textAlign: CanvasTextAlign;
}

/**
 * Paint `text` token-by-token with the active token highlighted. Tokens
 * are wrapped to `maxWidth` and laid out as one or more visual lines.
 *
 * Returns the active word index actually used (after computing from
 * progress) so callers can debug.
 */
export function paintKaraokeText(
  ctx: CanvasRenderingContext2D,
  opts: KaraokePaintOpts,
): number {
  const tokens = splitTokens(opts.text);
  if (tokens.length === 0) return -1;
  const activeIdx = activeWordIndex(opts.progress, tokens.length);
  const isCharSplit = !/\s/.test(opts.text.trim());
  // Space width depends only on the font, not the token. Reuse a single value.
  ctx.font = `${opts.fontWeight} ${opts.fontSize}px ${opts.family}`;
  const spaceW = isCharSplit ? 0 : ctx.measureText(' ').width;

  // Layout pass: compute per-token width and group into visual lines.
  type Slot = { token: string; width: number; idx: number };
  const lines: Slot[][] = [[]];
  let lineW = 0;
  tokens.forEach((token, idx) => {
    const w = ctx.measureText(token).width;
    const addW = lines[lines.length - 1].length === 0 ? w : w + spaceW;
    if (lineW + addW > opts.maxWidth && lines[lines.length - 1].length > 0) {
      lines.push([]);
      lineW = w;
    } else {
      lineW += addW;
    }
    lines[lines.length - 1].push({ token, width: w, idx });
  });

  // Paint pass.
  const lineHeight = Math.round(opts.fontSize * 1.18);
  const totalH = lines.length * lineHeight;
  let y = opts.y - totalH / 2 + lineHeight / 2;

  for (const line of lines) {
    const widths = line.map((s) => s.width);
    const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, line.length - 1);
    let cursor = (() => {
      switch (opts.textAlign) {
        case 'left':
          return opts.x;
        case 'right':
          return opts.x - totalW;
        case 'center':
        default:
          return opts.x - totalW / 2;
      }
    })();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (const slot of line) {
      const isActive = slot.idx === activeIdx;
      const isPast = slot.idx < activeIdx;
      const isFuture = slot.idx > activeIdx;

      const color = isActive
        ? opts.activeColor
        : isFuture
          ? withAlpha(opts.baseColor, 0.45)
          : opts.baseColor;

      ctx.save();
      if (isActive && opts.glowAmount > 0) {
        // Stronger drop-shadow with active color → emulates karaoke "lit" word.
        ctx.shadowColor = withAlpha(opts.glowColor ?? opts.activeColor, 0.65 + opts.glowAmount * 0.35);
        ctx.shadowBlur = 14 + opts.glowAmount * 28;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else if (opts.shadow.outline) {
        ctx.strokeStyle = opts.shadow.color;
        ctx.lineWidth = Math.max(2, Math.round(opts.fontSize * 0.05));
        ctx.lineJoin = 'round';
        ctx.strokeText(slot.token, cursor, y);
      } else {
        ctx.shadowColor = opts.shadow.color;
        ctx.shadowBlur = opts.shadow.blur;
        ctx.shadowOffsetX = opts.shadow.offsetX;
        ctx.shadowOffsetY = opts.shadow.offsetY;
      }
      ctx.fillStyle = color;
      ctx.fillText(slot.token, cursor, y);
      ctx.restore();

      cursor += slot.width + spaceW;
      void isPast;
    }
    y += lineHeight;
  }

  return activeIdx;
}

/* ---------------------------------- helpers --------------------------------- */

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) {
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return color;
    const [r, g, b] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const cleaned = color.startsWith('#') ? color.slice(1) : color;
  if (cleaned.length !== 6) return color;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
