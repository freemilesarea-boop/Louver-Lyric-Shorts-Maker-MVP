import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { MOTION_DESCRIPTION, MOTION_LABEL, MOTION_PRESETS } from '../../shared/motion';
import type { MotionPreset } from '../../shared/types';

export default function MotionSelector(): JSX.Element {
  const manual = useProjectStore((s) => s.manualMotionPreset);
  const setManual = useProjectStore((s) => s.setManualMotionPreset);
  const template = useProjectStore(selectedTemplate);
  const templateDefault: MotionPreset = template.motionPreset ?? 'none';
  const effective = manual ?? templateDefault;

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
          템플릿 기본:&nbsp;
          <span className="font-semibold text-white">{MOTION_LABEL[templateDefault]}</span>
        </span>
        <select
          value={manual ?? '__auto__'}
          onChange={(e) => {
            const v = e.target.value;
            setManual(v === '__auto__' ? null : (v as MotionPreset));
          }}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          title="사진 움직임을 직접 선택"
        >
          <option value="__auto__">자동 ({MOTION_LABEL[templateDefault]})</option>
          {MOTION_PRESETS.map((p) => (
            <option key={p} value={p}>
              {MOTION_LABEL[p]}
            </option>
          ))}
        </select>
        {manual && (
          <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
            직접 선택: {MOTION_LABEL[effective]}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white/50">
        {MOTION_DESCRIPTION[effective]}{' '}
        <span className="text-white/30">미리보기에서 바로 확인할 수 있어요.</span>
      </div>
    </div>
  );
}
