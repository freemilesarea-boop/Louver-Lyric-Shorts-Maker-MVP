import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { api } from '../lib/api';
import {
  formatTime,
  suggestHookSections,
  type HookCandidate,
} from '../../shared/hookSuggest';
import { prettyErrorMessage } from '../../shared/errors';

/**
 * Hook section auto-suggest — surfaces 1-3 candidate windows for the
 * currently-loaded audio. Each candidate has an "적용" button that
 * updates startSec; durationSec stays at whatever the user chose
 * (15 / 30 / 60).
 *
 * The cached `amplitudeCurve` in the store covers only the *selected*
 * clip range (Phase 2-3 analysis), so for hook suggestion we re-analyze
 * the full audio (0..audioDurationSec) via the IPC. The full-range
 * analysis is reasonably cheap (PCM at 8 kHz mono) and only happens
 * when the user clicks the button.
 */
export default function HookSuggester(): JSX.Element {
  const audioPath = useProjectStore((s) => s.audioPath);
  const audioDurationSec = useProjectStore((s) => s.audioDurationSec);
  const durationSec = useProjectStore((s) => s.durationSec);
  const setStartSec = useProjectStore((s) => s.setStartSec);

  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<HookCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSuggest = async () => {
    if (!audioPath) return;
    setError(null);
    setBusy(true);
    setCandidates(null);
    try {
      // Analyze the entire audio file, not just the currently selected
      // clip. Cheap enough to do on click — ~20 samples/sec PCM analysis.
      const fullCurve = await api().analyzeAmplitude(audioPath, 0, audioDurationSec);
      const result = suggestHookSections(fullCurve, audioDurationSec, durationSec);
      setCandidates(result);
    } catch (e) {
      setError(prettyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onApply = (c: HookCandidate) => {
    setStartSec(c.startSec);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSuggest}
          disabled={!audioPath || busy}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-ink-950 hover:bg-accent-soft disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
          title="현재 오디오에서 쇼츠용 하이라이트 구간 자동 추천"
        >
          {busy ? '분석 중...' : '🎯 하이라이트 구간 추천'}
        </button>
        <span className="text-[10px] text-white/40">
          현재 영상 길이({durationSec}s) 기준 · amplitude 기반
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
          {error}
        </div>
      )}

      {candidates !== null && !error && (
        <CandidateList
          candidates={candidates}
          onApply={onApply}
        />
      )}
    </div>
  );
}

function CandidateList(props: {
  candidates: HookCandidate[];
  onApply: (c: HookCandidate) => void;
}): JSX.Element {
  if (props.candidates.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-ink-800/50 px-2.5 py-1.5 text-[11px] text-white/60">
        추천할 만한 하이라이트 구간을 찾지 못했어요. 직접 시작 시간을 선택해주세요.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-ink-800/40">
      {props.candidates.map((c, i) => (
        <li key={`${c.startSec}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
          <div className="w-12 shrink-0 text-[10px] text-white/40">추천 {i + 1}</div>
          <div className="flex-1 font-mono">
            {formatTime(c.startSec)} ~ {formatTime(c.endSec)}
          </div>
          <div className="w-24 shrink-0 text-right">
            <span className="text-[10px] text-white/50">energy </span>
            <span className="font-mono text-emerald-300">{c.energyScore.toFixed(2)}</span>
          </div>
          <button
            onClick={() => props.onApply(c)}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/15"
          >
            적용
          </button>
        </li>
      ))}
    </ul>
  );
}
