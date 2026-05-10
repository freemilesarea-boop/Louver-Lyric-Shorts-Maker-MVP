/**
 * Watermark / branding system.
 *
 * Subtle, single-line text rendered on top of every frame. Drawn from the
 * shared scene renderer so preview and export agree pixel-for-pixel.
 *
 * Design notes:
 *   - No animation. The brief calls for "quiet branding" — a static glyph
 *     at low alpha. Animated logos are explicitly out of scope.
 *   - The painter is intentionally template-agnostic. White at low alpha
 *     reads on most backgrounds we ship; templates with very bright photos
 *     can use `center_fade` (lower alpha) to stay invisible in busy frames.
 *   - `shouldShowWatermark()` is the single seam for future free/pro tier
 *     logic. Today it just returns `cfg.enabled`. A future build can flip
 *     it to "force on for tier === 'free', honor toggle for 'pro'" without
 *     touching any other call site.
 */

export type WatermarkPosition =
  | 'bottom_left'
  | 'bottom_right'
  | 'top_left'
  | 'top_right'
  | 'center_fade';

export const WATERMARK_POSITIONS: WatermarkPosition[] = [
  'bottom_left',
  'bottom_right',
  'top_left',
  'top_right',
  'center_fade',
];

export const WATERMARK_POSITION_LABEL: Record<WatermarkPosition, string> = {
  bottom_left: '좌하단',
  bottom_right: '우하단',
  top_left: '좌상단',
  top_right: '우상단',
  center_fade: '중앙 페이드',
};

/** Default brand text used when the user leaves the input empty. */
export const DEFAULT_WATERMARK_TEXT = 'Made with Louver';

export interface WatermarkConfig {
  enabled: boolean;
  /** Empty/whitespace = use DEFAULT_WATERMARK_TEXT. */
  text: string;
  position: WatermarkPosition;
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: true,
  text: '',
  position: 'bottom_right',
};

/**
 * Tier hook. Today: just respect the toggle. A future build wires user
 * tier in here — free forces on, pro honors the toggle.
 */
export function shouldShowWatermark(cfg: WatermarkConfig | null | undefined): boolean {
  if (!cfg) return false;
  return cfg.enabled === true;
}

/** Resolve display text — falls back to the bundled default. */
export function effectiveWatermarkText(cfg: WatermarkConfig): string {
  const trimmed = (cfg.text ?? '').trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_WATERMARK_TEXT;
}

export interface WatermarkPaintOpts {
  /** CSS font-family list. Defaults to a system sans stack so the watermark
   *  doesn't pull a custom font's weight onto a template that uses a display
   *  face for lyrics. */
  fontFamily?: string;
}

/**
 * Paint the watermark on the provided context. No-op when the toggle is
 * off (or the tier hook says hide). Designed to run as the very last paint
 * step so it sits above lyrics, FX, and reactive layers.
 *
 * Coordinates are canonical (1080×1920); call site is expected to have
 * already applied the scene scale transform.
 */
export function paintWatermark(
  ctx: CanvasRenderingContext2D,
  sceneW: number,
  sceneH: number,
  cfg: WatermarkConfig | null | undefined,
  opts: WatermarkPaintOpts = {},
): void {
  if (!shouldShowWatermark(cfg)) return;
  const config = cfg as WatermarkConfig;
  const text = effectiveWatermarkText(config);

  const fontSize = 22;
  const margin = 48;
  const family =
    opts.fontFamily ??
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  let x: number;
  let y: number;
  let textAlign: CanvasTextAlign;
  let alpha: number;

  switch (config.position) {
    case 'bottom_left':
      x = margin;
      y = sceneH - margin;
      textAlign = 'left';
      alpha = 0.45;
      break;
    case 'bottom_right':
      x = sceneW - margin;
      y = sceneH - margin;
      textAlign = 'right';
      alpha = 0.45;
      break;
    case 'top_left':
      x = margin;
      y = margin;
      textAlign = 'left';
      alpha = 0.45;
      break;
    case 'top_right':
      x = sceneW - margin;
      y = margin;
      textAlign = 'right';
      alpha = 0.45;
      break;
    case 'center_fade':
    default:
      x = sceneW / 2;
      y = sceneH / 2;
      textAlign = 'center';
      // Centered watermark sits on top of the photo card — extra-low alpha
      // so it reads as a faint mark, not a label.
      alpha = 0.18;
      break;
  }

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `500 ${fontSize}px ${family}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';
  // Subtle glow so the mark doesn't disappear into matching backgrounds.
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}
