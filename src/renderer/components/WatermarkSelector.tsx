import { useProjectStore } from '../store/projectStore';
import {
  DEFAULT_WATERMARK_TEXT,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABEL,
  type WatermarkPosition,
} from '../../shared/watermark';

/**
 * Watermark / branding panel — toggle + custom text + position. Writes
 * directly to the store; preview canvas and export overlays read the same
 * fields. Empty text input falls back to the bundled default.
 */
export default function WatermarkSelector(): JSX.Element {
  const enabled = useProjectStore((s) => s.watermarkEnabled);
  const text = useProjectStore((s) => s.watermarkText);
  const position = useProjectStore((s) => s.watermarkPosition);
  const setEnabled = useProjectStore((s) => s.setWatermarkEnabled);
  const setText = useProjectStore((s) => s.setWatermarkText);
  const setPosition = useProjectStore((s) => s.setWatermarkPosition);

  const effectiveText = text.trim() || DEFAULT_WATERMARK_TEXT;

  return (
    <div className="space-y-2 text-xs">
      <label className="flex cursor-pointer items-center gap-2 text-white/80">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Watermark 표시 ({enabled ? 'ON' : 'OFF'})
      </label>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={DEFAULT_WATERMARK_TEXT}
          disabled={!enabled}
          className="rounded-md border border-white/10 bg-ink-800 px-2.5 py-1.5 text-xs placeholder:text-white/30 focus:border-white/40 focus:outline-none disabled:opacity-40"
          maxLength={48}
        />
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as WatermarkPosition)}
          disabled={!enabled}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-xs focus:border-white/40 focus:outline-none disabled:opacity-40"
        >
          {WATERMARK_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {WATERMARK_POSITION_LABEL[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="text-[11px] text-white/40">
        현재 표시: <span className="text-white/70">{effectiveText}</span>
        {!text.trim() && <span className="ml-1 text-white/30">(기본값)</span>}
      </div>
    </div>
  );
}
