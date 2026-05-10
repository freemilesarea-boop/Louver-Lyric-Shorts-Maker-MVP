import type { Template } from './types';
import { resolveLyricPositioning } from './scene';

/**
 * Mobile platform safe-zone overlay.
 *
 * PREVIEW-ONLY. The safe-zone painter is called AFTER renderScene from
 * the live preview canvas. It is never invoked by the export overlay
 * generator (src/renderer/lib/overlays.ts) or scene.ts itself, so the
 * baked PNG keyframes that ffmpeg composites stay clean.
 *
 * Coordinates below are stored as fractions of the canonical 1080×1920
 * frame so they're resolution-agnostic. The numbers are deliberate
 * over-approximations of where each platform's overlay UI sits — they
 * shift slightly between phone models and app versions, so we err on
 * the side of "treat this whole band as risky" rather than "perfectly
 * pixel-accurate."
 */

export type SafePlatform = 'shorts' | 'reels' | 'tiktok';

export const SAFE_PLATFORM_LABEL: Record<SafePlatform, string> = {
  shorts: 'YouTube Shorts',
  reels: 'Instagram Reels',
  tiktok: 'TikTok',
};

export const SAFE_PLATFORMS: SafePlatform[] = ['shorts', 'reels', 'tiktok'];

/** Rect expressed as fractions of frame width/height. */
export interface SafeRect {
  /** Free-form label (Korean OK). */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatformSafeZones {
  /** Description / caption / handle band along the bottom. */
  bottom: SafeRect;
  /** Right-side action buttons column (like, comment, share, music, etc). */
  right: SafeRect;
  /** Title / status / search pill at the very top. */
  top?: SafeRect;
  /** Profile avatar / artist info typically tucked at bottom-left. */
  profile?: SafeRect;
}

/**
 * Per-platform safe-zone definitions. Generous on purpose — UI heights
 * vary across iOS/Android, font sizes, and app versions, so it's better
 * to flag a slightly-too-big area than miss a collision.
 */
export const PLATFORM_SAFE_ZONES: Record<SafePlatform, PlatformSafeZones> = {
  shorts: {
    bottom: { label: '하단 설명', x: 0,    y: 0.84, w: 0.86, h: 0.16 },
    right:  { label: '우측 버튼', x: 0.86, y: 0.50, w: 0.14, h: 0.42 },
    top:    { label: '상단 영역', x: 0,    y: 0,    w: 1,    h: 0.06 },
  },
  reels: {
    bottom: { label: '캡션·핸들', x: 0,    y: 0.82, w: 0.85, h: 0.18 },
    right:  { label: '우측 버튼', x: 0.85, y: 0.48, w: 0.15, h: 0.40 },
    top:    { label: '상단 영역', x: 0,    y: 0,    w: 1,    h: 0.07 },
  },
  tiktok: {
    bottom: { label: '캡션·해시', x: 0,    y: 0.80, w: 0.85, h: 0.20 },
    right:  { label: '우측 버튼', x: 0.85, y: 0.42, w: 0.15, h: 0.42 },
    top:    { label: 'For You',   x: 0,    y: 0,    w: 1,    h: 0.05 },
    profile: { label: '프로필',   x: 0.85, y: 0.34, w: 0.15, h: 0.08 },
  },
};

/* ----------------------- canvas painter (preview only) ---------------------- */

const ZONE_FILL = 'rgba(255, 80, 80, 0.18)';
const ZONE_STROKE = 'rgba(255, 80, 80, 0.85)';
const ZONE_LABEL = 'rgba(255, 230, 230, 0.95)';

export function paintSafeZones(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  platform: SafePlatform,
): void {
  const z = PLATFORM_SAFE_ZONES[platform];
  const zones: SafeRect[] = [z.bottom, z.right];
  if (z.top) zones.push(z.top);
  if (z.profile) zones.push(z.profile);

  ctx.save();
  for (const r of zones) {
    const rx = r.x * width;
    const ry = r.y * height;
    const rw = r.w * width;
    const rh = r.h * height;

    ctx.fillStyle = ZONE_FILL;
    ctx.fillRect(rx, ry, rw, rh);

    ctx.strokeStyle = ZONE_STROKE;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(rx, ry, rw, rh);

    // Label sits inside the rect, top-left padded.
    ctx.setLineDash([]);
    ctx.fillStyle = ZONE_LABEL;
    ctx.font = `600 ${Math.round(height * 0.018)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`SAFE · ${r.label}`, rx + 16, ry + 12);
  }
  // Header pill bottom-center.
  const pillW = Math.round(width * 0.4);
  const pillH = Math.round(height * 0.028);
  const pillX = (width - pillW) / 2;
  const pillY = Math.round(height * 0.46);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = 'rgba(255,80,80,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(pillX, pillY, pillW, pillH);
  ctx.fillStyle = '#ffe6e6';
  ctx.font = `700 ${Math.round(height * 0.018)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${SAFE_PLATFORM_LABEL[platform]} Safe Zone Preview · 출력 영상에는 포함되지 않음`,
    width / 2,
    pillY + pillH / 2,
  );
  ctx.restore();
}

/* ------------------------- collision (advisory only) ------------------------ */

export interface CollisionResult {
  collides: boolean;
  /** Human-readable reason (Korean). Empty when !collides. */
  message: string;
  /** Which zone(s) the lyric overlaps with. */
  zones: SafeRect[];
}

/**
 * Check whether the *base* lyric position (template-resolved) overlaps any
 * of the platform's safe-zone rects. The lyric Y range is approximated as
 * yEN ± fontSize and yKO ± fontSize × 0.78. Returns a friendly message the
 * UI can show under the preview.
 *
 * Note: this only checks the base position — it does not track animation
 * (slide_up/down) momentary positions. Those are intentionally subtle
 * (≤36px translation) and don't materially change collision risk.
 */
export function lyricCollidesWithSafeZone(
  template: Template,
  platform: SafePlatform,
  /** Canonical scene height (defaults to 1920). */
  sceneHeight = 1920,
): CollisionResult {
  const pos = resolveLyricPositioning(template);
  const enHalf = Math.round(template.fontSize * 0.6);
  const koHalf = Math.round(template.fontSize * 0.6 * 0.78);
  const top = Math.min(pos.yEN - enHalf, pos.yKO - koHalf);
  const bottom = Math.max(pos.yEN + enHalf, pos.yKO + koHalf);

  const zonesPx = collectZonesPx(platform, sceneHeight);
  const collisions = zonesPx.filter((z) => top < z.bottom && bottom > z.top);

  if (collisions.length === 0) {
    return { collides: false, message: '', zones: [] };
  }
  const labels = collisions.map((c) => c.rect.label).join(', ');
  return {
    collides: true,
    message: `현재 자막 위치가 ${SAFE_PLATFORM_LABEL[platform]}의 ${labels} 영역과 겹칠 수 있어요. 가사 위치(top/center/bottom)를 바꿔보세요.`,
    zones: collisions.map((c) => c.rect),
  };
}

function collectZonesPx(platform: SafePlatform, sceneHeight: number) {
  const z = PLATFORM_SAFE_ZONES[platform];
  const out: { rect: SafeRect; top: number; bottom: number }[] = [];
  const push = (r?: SafeRect) => {
    if (!r) return;
    out.push({
      rect: r,
      top: r.y * sceneHeight,
      bottom: (r.y + r.h) * sceneHeight,
    });
  };
  push(z.top);
  push(z.bottom);
  push(z.profile);
  // Right-column rect is X-bounded — for simplicity we still check Y overlap;
  // most lyric layouts are full-width so this is the realistic check.
  push(z.right);
  return out;
}
