import { selectedTemplate, useProjectStore } from '../store/projectStore';
import {
  SAFE_PLATFORMS,
  SAFE_PLATFORM_LABEL,
  SAFE_POSITION_LABEL,
  lyricCollidesWithSafeZone,
  suggestSafeLyricPosition,
  type SafePlatform,
} from '../../shared/safeZones';

/**
 * Editor toggle for the mobile safe-zone preview overlay. Shows ON/OFF
 * checkbox + platform select. When ON:
 *   - paints the safe-zone overlay (in LivePreview, not here)
 *   - shows a collision warning if the current lyric position overlaps
 *   - exposes "추천 위치 적용" — runs `suggestSafeLyricPosition` and
 *     stores the result as a project-level override (manualLyricPosition)
 *     so single + batch renders both pick it up.
 *
 * Safe-zone painting is preview-only; the position override IS exported.
 */
export default function SafeZoneToggle(): JSX.Element {
  const enabled = useProjectStore((s) => s.safeZoneEnabled);
  const platform = useProjectStore((s) => s.safeZonePlatform);
  const setEnabled = useProjectStore((s) => s.setSafeZoneEnabled);
  const setPlatform = useProjectStore((s) => s.setSafeZonePlatform);
  const template = useProjectStore(selectedTemplate);
  const manualPos = useProjectStore((s) => s.manualLyricPosition);
  const setManualPos = useProjectStore((s) => s.setManualLyricPosition);

  // Collision check uses the current effective position (override if any,
  // else template default).
  const collision = enabled
    ? lyricCollidesWithSafeZone(template, platform, 1920, manualPos ?? null)
    : null;

  const onApplySuggestion = () => {
    const next = suggestSafeLyricPosition(template, platform);
    setManualPos(next);
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-white/80">Safe Zone 미리보기</span>
        </label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as SafePlatform)}
          disabled={!enabled}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none disabled:opacity-50"
          title="플랫폼 선택"
        >
          {SAFE_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {SAFE_PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
          guide overlay 는 출력에 미포함
        </span>
        {manualPos && (
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">
            위치 override: {SAFE_POSITION_LABEL[manualPos]}
          </span>
        )}
      </div>

      {collision?.collides && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-yellow-200">
          <div>⚠️ {collision.message}</div>
          <button
            onClick={onApplySuggestion}
            className="mt-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-ink-950 hover:bg-accent-soft"
          >
            추천 위치 적용
          </button>
        </div>
      )}

      {!collision?.collides && manualPos && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-300">
          <span>✓ 안전 위치 적용됨</span>
          <button
            onClick={() => setManualPos(null)}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/20"
            title="템플릿 기본 위치로 복귀"
          >
            override 해제
          </button>
        </div>
      )}
    </div>
  );
}
