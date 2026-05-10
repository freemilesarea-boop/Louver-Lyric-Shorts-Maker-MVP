import { useProjectStore } from '../store/projectStore';
import { LANGUAGE_LABEL } from '../../shared/lang';
import { SAMPLE_PRESETS, type SamplePreset } from '../samples/samplePresets';

/**
 * One-click "vibe" picker. Each card sets template + motion + animation +
 * reactive + FX + manual language at once so a user can audition a complete
 * look without touching every selector below.
 */
export default function SamplePresetPicker(): JSX.Element {
  const apply = useApplySamplePreset();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {SAMPLE_PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => apply(p)}
          className="rounded-lg border border-white/10 bg-ink-800/60 p-3 text-left transition-colors hover:border-white/30 hover:bg-ink-800"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/60">
              {LANGUAGE_LABEL[p.recommendedLanguage]}
            </div>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-white/60">{p.description}</div>
          <div className="mt-1.5 text-[10px] text-white/40">{p.lyricStyleHint}</div>
        </button>
      ))}
    </div>
  );
}

function useApplySamplePreset() {
  const setSelectedTemplate = useProjectStore((s) => s.setSelectedTemplate);
  const setManualMotionPreset = useProjectStore((s) => s.setManualMotionPreset);
  const setManualAnimationPreset = useProjectStore((s) => s.setManualAnimationPreset);
  const setManualReactiveMode = useProjectStore((s) => s.setManualReactiveMode);
  const setManualFxPreset = useProjectStore((s) => s.setManualFxPreset);
  const setManualLanguage = useProjectStore((s) => s.setManualLanguage);

  return (preset: SamplePreset) => {
    setSelectedTemplate(preset.templateId);
    setManualMotionPreset(preset.motionPreset);
    setManualAnimationPreset(preset.animationPreset);
    setManualReactiveMode(preset.reactiveMode);
    setManualFxPreset(preset.cinematicFxPreset);
    setManualLanguage(preset.recommendedLanguage);
  };
}
