import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { MOTION_LABEL, MOTION_PRESETS } from '../../shared/motion';
import type { MotionPreset } from '../../shared/types';

export default function MotionSelector(): JSX.Element {
  const manual = useProjectStore((s) => s.manualMotionPreset);
  const setManual = useProjectStore((s) => s.setManualMotionPreset);
  const template = useProjectStore(selectedTemplate);
  const templateDefault: MotionPreset = template.motionPreset ?? 'none';
  const effective = manual ?? templateDefault;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
        Template default:&nbsp;
        <span className="font-semibold text-white">{MOTION_LABEL[templateDefault]}</span>
      </span>
      <select
        value={manual ?? '__auto__'}
        onChange={(e) => {
          const v = e.target.value;
          setManual(v === '__auto__' ? null : (v as MotionPreset));
        }}
        className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
        title="모션 수동 선택 (템플릿 기본값 무시)"
      >
        <option value="__auto__">Auto ({MOTION_LABEL[templateDefault]})</option>
        {MOTION_PRESETS.map((p) => (
          <option key={p} value={p}>
            {MOTION_LABEL[p]}
          </option>
        ))}
      </select>
      {manual && (
        <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
          Manual: {MOTION_LABEL[effective]}
        </span>
      )}
    </div>
  );
}
