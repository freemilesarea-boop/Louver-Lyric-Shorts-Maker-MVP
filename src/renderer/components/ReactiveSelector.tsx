import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { REACTIVE_LABEL, REACTIVE_MODES } from '../../shared/audioReactive';
import type { ReactiveMode } from '../../shared/types';

export default function ReactiveSelector(): JSX.Element {
  const manual = useProjectStore((s) => s.manualReactiveMode);
  const setManual = useProjectStore((s) => s.setManualReactiveMode);
  const curve = useProjectStore((s) => s.amplitudeCurve);
  const template = useProjectStore(selectedTemplate);
  const templateDefault: ReactiveMode = template.reactiveMode ?? 'none';
  const effective = manual ?? templateDefault;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
          Template default:&nbsp;
          <span className="font-semibold text-white">{REACTIVE_LABEL[templateDefault]}</span>
        </span>
        <select
          value={manual ?? '__auto__'}
          onChange={(e) => {
            const v = e.target.value;
            setManual(v === '__auto__' ? null : (v as ReactiveMode));
          }}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          title="오디오 리액티브 모드 수동 선택"
        >
          <option value="__auto__">Auto ({REACTIVE_LABEL[templateDefault]})</option>
          {REACTIVE_MODES.map((m) => (
            <option key={m} value={m}>
              {REACTIVE_LABEL[m]}
            </option>
          ))}
        </select>
        {manual && (
          <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
            Manual: {REACTIVE_LABEL[effective]}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white/40">
        {curve
          ? `Amplitude curve: ${curve.values.length} samples · ${curve.intervalSec.toFixed(2)}s interval`
          : '오디오 분석 대기 중 — Editor에 들어오면 자동 분석됩니다.'}
      </div>
    </div>
  );
}
