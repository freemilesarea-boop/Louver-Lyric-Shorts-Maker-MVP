import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { FX_LABEL, FX_PRESETS } from '../../shared/cinematicFx';
import type { FxPreset } from '../../shared/types';

export default function CinematicFxSelector(): JSX.Element {
  const manual = useProjectStore((s) => s.manualFxPreset);
  const setManual = useProjectStore((s) => s.setManualFxPreset);
  const template = useProjectStore(selectedTemplate);
  const templateDefault: FxPreset = template.cinematicFxPreset ?? 'none';
  const effective = manual ?? templateDefault;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
        Template default:&nbsp;
        <span className="font-semibold text-white">{FX_LABEL[templateDefault]}</span>
      </span>
      <select
        value={manual ?? '__auto__'}
        onChange={(e) => {
          const v = e.target.value;
          setManual(v === '__auto__' ? null : (v as FxPreset));
        }}
        className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
        title="시네마틱 FX 프리셋 수동 선택"
      >
        <option value="__auto__">Auto ({FX_LABEL[templateDefault]})</option>
        {FX_PRESETS.map((p) => (
          <option key={p} value={p}>
            {FX_LABEL[p]}
          </option>
        ))}
      </select>
      {manual && (
        <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
          Manual: {FX_LABEL[effective]}
        </span>
      )}
    </div>
  );
}
