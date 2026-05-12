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
          템플릿 기본:&nbsp;
          <span className="font-semibold text-white">{REACTIVE_LABEL[templateDefault]}</span>
        </span>
        <select
          value={manual ?? '__auto__'}
          onChange={(e) => {
            const v = e.target.value;
            setManual(v === '__auto__' ? null : (v as ReactiveMode));
          }}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          title="음악 반응 효과 직접 선택"
        >
          <option value="__auto__">자동 ({REACTIVE_LABEL[templateDefault]})</option>
          {REACTIVE_MODES.map((m) => (
            <option key={m} value={m}>
              {REACTIVE_LABEL[m]}
            </option>
          ))}
        </select>
        {manual && (
          <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
            직접 선택: {REACTIVE_LABEL[effective]}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white/40">
        {curve
          ? `음악 반응 분석 완료 (${curve.values.length}개 샘플)`
          : '오디오 불러오면 자동으로 분석돼요.'}
      </div>
    </div>
  );
}
