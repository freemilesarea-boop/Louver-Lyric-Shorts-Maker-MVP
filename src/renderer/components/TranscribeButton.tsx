import { useEffect, useState } from 'react';
import { useProjectStore, effectiveLanguage } from '../store/projectStore';
import { api } from '../lib/api';
import { prettyErrorMessage } from '../../shared/errors';
import type { WhisperSelfCheckInfo } from '../../shared/api';
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
  /** Phase 5-10 — full per-prerequisite check from the main process.
   *  When `available` is false, this carries the exact reason (which
   *  file is missing, what size the model is, etc.) so we can show
   *  a precise diagnostic instead of "Whisper not installed". */
  const [selfCheck, setSelfCheck] = useState<WhisperSelfCheckInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .whisperAvailable()
      .then((r) => {
        if (cancelled) return;
        setAvailable(r.ok);
        setSelfCheck(r.selfCheck ?? null);
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
        // Phase 5-11 — when the loudness probe says the slice was
        // essentially silent (meanDb < -45), tell the user that
        // directly instead of the generic "다른 구간을 시도해주세요"
        // — they need to extend the audio range, not change pitch.
        const tooQuiet = result.loudness?.tooQuiet;
        const meanDb = result.loudness?.meanDb;
        setError(
          tooQuiet
            ? `오디오가 너무 조용해요 (평균 ${meanDb?.toFixed(1)} dB). ` +
              `시작 시간을 늦추거나 보컬이 들어오는 구간으로 옮긴 뒤 다시 시도해주세요.`
            : '가사를 인식하지 못했습니다. 다른 구간을 시도해주세요.',
        );
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
        <div className="space-y-1.5 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-yellow-200">
          {/* Phase 5-10 — precise diagnostic. The bundled engine
            *  ships with the installer; if it's missing OR corrupt
            *  we tell the user exactly what to fix instead of
            *  pretending they need to install something. */}
          <div className="font-semibold">
            내장 AI 가사 엔진을 사용할 수 없어요.
          </div>
          {selfCheck && (
            <ul className="ml-3 list-disc space-y-0.5 text-[10.5px] text-yellow-200/80">
              <li>
                실행 파일:{' '}
                {selfCheck.binFound
                  ? selfCheck.binExecutable
                    ? '✓ 발견 + 실행 가능'
                    : '⚠ 발견했지만 실행 실패'
                  : '✗ 없음'}
                {selfCheck.expectedBinPath && (
                  <span className="ml-1 font-mono text-[10px] text-yellow-200/60">
                    {selfCheck.expectedBinPath}
                  </span>
                )}
              </li>
              {/* Phase 5-10.1 — surface the loader error (DLL missing,
                *  MOTW block, etc.) directly. The exit code + stderr
                *  line is what the user / dev needs to root-cause on
                *  a Windows install. */}
              {selfCheck.binFound && !selfCheck.binExecutable && (
                <li className="text-yellow-200/60">
                  실행 결과:{' '}
                  <span className="font-mono">
                    exit={selfCheck.binProbeExitCode ?? 'spawn-error'}
                  </span>
                  {selfCheck.binProbeStderr && (
                    <div className="mt-0.5 max-h-20 overflow-auto rounded bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-yellow-100/70 whitespace-pre-wrap">
                      {selfCheck.binProbeStderr.trim().slice(0, 400)}
                    </div>
                  )}
                </li>
              )}
              {selfCheck.binInsideAsar && (
                <li className="text-yellow-200/60">
                  ⚠ 경로가 app.asar 내부입니다 — 패키징 설정에서
                  extraResources / asarUnpack가 빠진 빌드입니다.
                </li>
              )}
              <li>
                모델 파일:{' '}
                {selfCheck.modelFound
                  ? `✓ 발견 (${(selfCheck.modelSizeBytes / 1024 / 1024).toFixed(1)} MB)`
                  : '✗ 없음'}
                {selfCheck.expectedModelPath && (
                  <span className="ml-1 font-mono text-[10px] text-yellow-200/60">
                    {selfCheck.expectedModelPath}
                  </span>
                )}
              </li>
            </ul>
          )}
          <div className="text-yellow-200/80">
            {selfCheck?.reason ??
              '앱을 재설치해주세요. 외부 Python / whisper / PATH 설정은 필요하지 않습니다.'}
          </div>
          <div className="text-[10.5px] text-yellow-200/60">
            그동안은 아래 입력란에 가사를 직접 입력하실 수 있어요.
          </div>
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
