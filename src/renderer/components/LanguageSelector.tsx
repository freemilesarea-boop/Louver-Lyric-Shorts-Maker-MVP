import { useProjectStore } from '../store/projectStore';
import { LANGUAGE_LABEL } from '../../shared/lang';
import type { LanguageCode } from '../../shared/types';

const LANGS: LanguageCode[] = ['ko', 'en', 'ja', 'zh', 'es', 'unknown'];

export default function LanguageSelector(): JSX.Element {
  const detected = useProjectStore((s) => s.detectedLanguage);
  const manual = useProjectStore((s) => s.manualLanguage);
  const setManual = useProjectStore((s) => s.setManualLanguage);
  const effective = manual ?? detected;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
        Detected:&nbsp;
        <span className="font-semibold text-white">{LANGUAGE_LABEL[detected]}</span>
      </span>
      <select
        value={manual ?? '__auto__'}
        onChange={(e) => {
          const v = e.target.value;
          setManual(v === '__auto__' ? null : (v as LanguageCode));
        }}
        className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
        title="언어 수동 선택 (자동 감지 무시)"
      >
        <option value="__auto__">Auto ({LANGUAGE_LABEL[detected]})</option>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_LABEL[l]}
          </option>
        ))}
      </select>
      {manual && (
        <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
          Manual: {LANGUAGE_LABEL[effective]}
        </span>
      )}
    </div>
  );
}
