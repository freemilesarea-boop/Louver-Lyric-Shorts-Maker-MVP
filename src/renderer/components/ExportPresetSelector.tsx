import { useProjectStore } from '../store/projectStore';
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_KEYS,
  type ExportPresetKey,
} from '../../shared/exportPresets';

/**
 * Export preset picker. Writes to `exportPresetKey` in the store. The
 * setter auto-links the safe-zone platform when the preset specifies one
 * (Master leaves the user's safe-zone selection alone).
 *
 * The active preset is consumed by:
 *   - EditorScreen single-render dispatch (filename suffix + exportEncode).
 *   - BatchPicker → batchRender (same suffix + encode for every item).
 *   - main/render/pipeline.ts reads req.exportEncode as the libx264 / aac argv.
 */
export default function ExportPresetSelector(): JSX.Element {
  const exportPresetKey = useProjectStore((s) => s.exportPresetKey);
  const setExportPresetKey = useProjectStore((s) => s.setExportPresetKey);
  const def = EXPORT_PRESETS[exportPresetKey];

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={exportPresetKey}
          onChange={(e) => setExportPresetKey(e.target.value as ExportPresetKey)}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          title="플랫폼별 인코딩 프리셋"
        >
          {EXPORT_PRESET_KEYS.map((k) => (
            <option key={k} value={k}>
              {EXPORT_PRESETS[k].label}
            </option>
          ))}
        </select>
        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
          suffix: <span className="font-mono text-white">{def.filenameSuffix}</span>
        </span>
        {def.safeZonePlatform && (
          <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
            safe zone: {def.safeZonePlatform}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white/60">{def.description}</div>
      <div className="text-[10px] font-mono text-white/40">
        x264 -preset {def.encode.videoPreset} · CRF {def.encode.videoCrf} · AAC{' '}
        {def.encode.audioBitrateKbps}k
      </div>
    </div>
  );
}
