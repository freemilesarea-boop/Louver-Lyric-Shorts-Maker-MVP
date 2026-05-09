import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { ANIMATION_LABEL, ANIMATION_PRESETS } from '../../shared/animation';
import type { AnimationPreset } from '../../shared/types';

export default function AnimationSelector(): JSX.Element {
  const manual = useProjectStore((s) => s.manualAnimationPreset);
  const setManual = useProjectStore((s) => s.setManualAnimationPreset);
  const template = useProjectStore(selectedTemplate);
  const templateDefault: AnimationPreset = template.animationPreset ?? 'none';
  const effective = manual ?? templateDefault;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
        Template default:&nbsp;
        <span className="font-semibold text-white">{ANIMATION_LABEL[templateDefault]}</span>
      </span>
      <select
        value={manual ?? '__auto__'}
        onChange={(e) => {
          const v = e.target.value;
          setManual(v === '__auto__' ? null : (v as AnimationPreset));
        }}
        className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
        title="가사 애니메이션 수동 선택 (템플릿 기본값 무시)"
      >
        <option value="__auto__">Auto ({ANIMATION_LABEL[templateDefault]})</option>
        {ANIMATION_PRESETS.map((p) => (
          <option key={p} value={p}>
            {ANIMATION_LABEL[p]}
          </option>
        ))}
      </select>
      {manual && (
        <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
          Manual: {ANIMATION_LABEL[effective]}
        </span>
      )}
    </div>
  );
}
