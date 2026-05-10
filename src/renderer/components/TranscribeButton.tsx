import { useEffect, useState } from 'react';
import { useProjectStore, effectiveLanguage } from '../store/projectStore';
import { api } from '../lib/api';
import { prettyErrorMessage } from '../../shared/errors';
import type { LyricLine } from '../../shared/types';

/**
 * "AI 가사 추출" button. On click:
 *   1. Asks the main process to run whisper on the *currently selected*
 *      audio range (startSec → startSec + durationSec).
 *   2. On success, populates the lyrics textarea + parsedLyrics with the
 *      transcribed segments and updates detectedLanguage.
 *   3. On failure, shows the friendly Korean message returned by the IPC
 *      reply (Whisper-not-installed text or prettyErrorMessage output).
 *
 * The user can still edit / replace the transcript afterward — manual
 * lyric input keeps working unchanged.
 */
export default function TranscribeButton(): JSX.Element {
  const audioPath = useProjectStore((s) => s.audioPath);
  const startSec = useProjectStore((s) => s.startSec);
  const durationSec = useProjectStore((s) => s.durationSec);
  const setLyricsRaw = useProjectStore((s) => s.setLyricsRaw);
  const setManualLanguage = useProjectStore((s) => s.setManualLanguage);
  const language = useProjectStore(effectiveLanguage);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .whisperAvailable()
      .then((r) => {
        if (!cancelled) setAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = async () => {
    if (!audioPath || busy) return;
    setError(null);
    setStatus('가사 추출 중...');
    setBusy(true);
    try {
      const result = await api().transcribe({
        audioPath,
        startSec,
        durationSec,
        languageHint: language === 'unknown' ? 'auto' : language,
      });
      if (!result.ok) {
        if (result.notInstalled) {
          setAvailable(false);
        }
        setError(result.error ?? '가사 추출에 실패했습니다.');
        setStatus(null);
        return;
      }
      const lines = result.lines ?? [];
      if (lines.length === 0) {
        setError('가사를 인식하지 못했습니다. 다른 구간을 시도해주세요.');
        setStatus(null);
        return;
      }
      // Convert lines to plain text (one per line). The store's setLyricsRaw
      // re-parses + redistributes timing; manual timeline edits afterward
      // still work as before.
      const raw = lines.map((l: LyricLine) => l.text).join('\n');
      setLyricsRaw(raw);
      // If whisper detected a concrete language, surface it as the manual
      // override so subsequent renders use the right font stack.
      if (result.language && /^(ko|en|ja|zh|es)$/.test(result.language)) {
        setManualLanguage(result.language as 'ko' | 'en' | 'ja' | 'zh' | 'es');
      }
      setStatus(`완료 · ${lines.length}개 라인 추출 (${result.language ?? 'lang?'})`);
    } catch (e) {
      setError(prettyErrorMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!busy) return;
    await api().cancelTranscribe();
    setStatus('취소됨');
    setBusy(false);
  };

  const disabled = !audioPath || busy || available === false;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onClick}
          disabled={disabled}
          className={[
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
            disabled
              ? 'bg-white/5 text-white/30 cursor-not-allowed'
              : 'bg-accent text-ink-950 hover:bg-accent-soft',
          ].join(' ')}
          title={
            available === false
              ? '자동 가사 추출 엔진이 포함되지 않은 빌드입니다. 가사를 직접 입력해주세요.'
              : !audioPath
                ? '오디오를 먼저 업로드해주세요.'
                : '선택된 오디오 구간에서 가사를 자동으로 추출합니다'
          }
        >
          <span>✨</span> AI 가사 추출
        </button>
        {busy && (
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            취소
          </button>
        )}
        {status && !busy && <span className="text-[11px] text-emerald-300">{status}</span>}
        {busy && <span className="text-[11px] text-white/60">{status}</span>}
      </div>
      {available === false && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-yellow-200">
          이 빌드에는 자동 가사 추출 엔진이 포함되어 있지 않아요. 가사는
          아래 입력란에 직접 입력해주세요. (개발자: <code>resources/whisper/</code>
          {' '}README 참고)
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
