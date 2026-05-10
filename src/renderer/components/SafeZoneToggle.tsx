import { selectedTemplate, useProjectStore } from '../store/projectStore';
import {
  SAFE_PLATFORMS,
  SAFE_PLATFORM_LABEL,
  lyricCollidesWithSafeZone,
  type SafePlatform,
} from '../../shared/safeZones';

/**
 * Editor toggle for the mobile safe-zone preview overlay. Shows ON/OFF
 * checkbox + platform select. When ON, also surfaces a collision warning
 * if the current lyric position overlaps any platform safe zone.
 *
 * The overlay itself is painted by LivePreview after renderScene; this
 * component is only the control + advisory message.
 */
export default function SafeZoneToggle(): JSX.Element {
  const enabled = useProjectStore((s) => s.safeZoneEnabled);
  const platform = useProjectStore((s) => s.safeZonePlatform);
  const setEnabled = useProjectStore((s) => s.setSafeZoneEnabled);
  const setPlatform = useProjectStore((s) => s.setSafeZonePlatform);
  const template = useProjectStore(selectedTemplate);

  const collision = enabled ? lyricCollidesWithSafeZone(template, platform) : null;

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
          출력 영상에는 포함되지 않음
        </span>
      </div>

      {collision?.collides && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-yellow-200">
          ⚠️ {collision.message}
        </div>
      )}
    </div>
  );
}
