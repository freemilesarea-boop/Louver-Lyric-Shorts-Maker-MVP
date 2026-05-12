import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { UpdaterEventInfo } from '../../shared/api';

/**
 * Phase 5-11 — diagnostics + auto-updater UI.
 *
 * Three things live in one collapsible card so the user never has to
 * hunt around:
 *
 *   1. "오류 복사하기" — copies a 200KB log tail (with version /
 *      platform / Electron / Node header) to the clipboard for
 *      pasting into a bug report.
 *   2. "로그 폴더 열기" — opens the OS file manager at the log dir.
 *   3. "업데이트 확인" — manual check via electron-updater; the
 *      sticky banner at the top of this card also surfaces the
 *      passive events the main process emits (update-available,
 *      download-progress, update-downloaded).
 *
 * In dev / non-published builds the updater is disabled and the
 * update-related UI is replaced with a small "(개발 빌드)" note so we
 * don't pretend a non-existent feed is being polled.
 */
export default function DiagnosticsPanel(): JSX.Element {
  const [logPath, setLogPath] = useState<string>('(loading...)');
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const [event, setEvent] = useState<UpdaterEventInfo | null>(null);

  useEffect(() => {
    api()
      .logPath()
      .then(setLogPath)
      .catch(() => setLogPath('(unavailable)'));
    const unsub = api().onUpdaterEvent((e) => setEvent(e));
    return () => unsub();
  }, []);

  const onCopy = async () => {
    setCopyResult(null);
    try {
      const r = await api().copyDiagnostics();
      setCopyResult(
        r.ok ? `진단 정보 복사됨 · ${(r.bytes / 1024).toFixed(1)} KB` : '복사 실패',
      );
    } catch (e) {
      setCopyResult(`복사 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onCheck = async () => {
    setEvent({ kind: 'checking' });
    try {
      const r = await api().updaterCheck();
      setEvent(r);
    } catch (e) {
      setEvent({
        kind: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <details className="rounded-md border border-white/10 bg-ink-900/40 text-[12px]">
      <summary className="cursor-pointer select-none px-3 py-2 text-white/70 hover:text-white">
        🛠 진단 / 업데이트
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">
        {/* Updater banner — only when there's something live. */}
        {event && event.kind !== 'update-not-available' && (
          <UpdaterBanner event={event} onInstall={() => api().updaterQuitAndInstall()} />
        )}

        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-white/70">로그</div>
          <div className="font-mono text-[10.5px] text-white/40 break-all">{logPath}</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCopy}
              className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] hover:bg-white/15"
            >
              📋 오류 복사하기
            </button>
            <button
              onClick={() => api().openLogFolder()}
              className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] hover:bg-white/15"
            >
              📂 로그 폴더 열기
            </button>
            {copyResult && (
              <span className="text-[10.5px] text-emerald-300">{copyResult}</span>
            )}
          </div>
          <div className="text-[10.5px] text-white/40">
            버그를 알리실 때 "오류 복사하기"를 누르고 그 내용을 보내주세요.
          </div>
        </div>

        <div className="space-y-1 border-t border-white/5 pt-2">
          <div className="text-[11px] font-semibold text-white/70">자동 업데이트</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCheck}
              className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] hover:bg-white/15"
            >
              🔍 업데이트 확인
            </button>
            {event?.kind === 'update-not-available' && (
              <span className="text-[10.5px] text-white/60">최신 버전이에요.</span>
            )}
            {event?.kind === 'checking' && (
              <span className="text-[10.5px] text-white/60">확인 중...</span>
            )}
          </div>
          <div className="text-[10.5px] text-white/40">
            새 버전이 나오면 자동으로 알림이 떠요. 개발 빌드에서는 비활성화됩니다.
          </div>
        </div>
      </div>
    </details>
  );
}

function UpdaterBanner(props: {
  event: UpdaterEventInfo;
  onInstall: () => void;
}): JSX.Element | null {
  const e = props.event;
  if (e.kind === 'update-available') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-100">
        <div className="font-semibold">새 버전 {e.version} 다운로드 중...</div>
        {e.releaseNotes && (
          <div className="mt-1 max-h-24 overflow-auto text-[10.5px] text-emerald-200/80 whitespace-pre-wrap">
            {e.releaseNotes}
          </div>
        )}
      </div>
    );
  }
  if (e.kind === 'download-progress') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-100">
        <div className="font-semibold">
          업데이트 다운로드 {Math.round(e.percent ?? 0)}%
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-emerald-500/20">
          <div
            className="h-full bg-emerald-300 transition-all"
            style={{ width: `${e.percent ?? 0}%` }}
          />
        </div>
      </div>
    );
  }
  if (e.kind === 'update-downloaded') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-100">
        <div className="font-semibold">새 버전 {e.version} 설치 준비 완료.</div>
        <div className="mt-0.5 text-emerald-200/80">
          앱을 재시작하면 자동으로 적용됩니다.
        </div>
        <button
          onClick={props.onInstall}
          className="mt-1.5 rounded-md bg-emerald-400 px-2.5 py-1 text-[11px] font-semibold text-ink-950 hover:bg-emerald-300"
        >
          ▶ 지금 재시작
        </button>
      </div>
    );
  }
  if (e.kind === 'error') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
        업데이트 확인 실패: {e.error}
      </div>
    );
  }
  return null;
}
