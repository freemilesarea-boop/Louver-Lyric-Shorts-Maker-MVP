import { useProjectStore } from '../store/projectStore';
import { api } from '../lib/api';

export default function ExportScreen(): JSX.Element {
  const progress = useProjectStore((s) => s.lastRenderProgress);
  const isRendering = useProjectStore((s) => s.isRendering);
  const lastOutputPath = useProjectStore((s) => s.lastOutputPath);
  const lastError = useProjectStore((s) => s.lastError);
  const setScreen = useProjectStore((s) => s.setScreen);

  const stage = progress?.stage ?? (isRendering ? 'preparing' : 'preparing');
  const percent = Math.round(progress?.percent ?? 0);
  const cancelled = stage === 'cancelled';
  const error = !cancelled
    ? lastError ?? (stage === 'error' ? progress?.message ?? 'Unknown error' : null)
    : null;
  const done = stage === 'done' && !!lastOutputPath;

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-ink-900 p-8">
        <h1 className="text-2xl font-bold tracking-tight">영상 출력</h1>
        <p className="mt-1 text-sm text-white/60">1080×1920 H.264 MP4로 렌더링합니다.</p>

        <div className="mt-6">
          <div className="flex items-end justify-between text-xs text-white/60">
            <span>{stageLabel(stage)}</span>
            <span className="font-mono">{percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={[
                'h-full transition-all duration-200',
                error ? 'bg-red-400' : cancelled ? 'bg-white/30' : 'bg-accent',
              ].join(' ')}
              style={{ width: `${error ? 100 : percent}%` }}
            />
          </div>
        </div>

        {cancelled && (
          <div className="mt-6 rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/80">
            <div className="font-semibold">렌더가 취소되었습니다.</div>
          </div>
        )}

        {error && (
          <div className="mt-6 whitespace-pre-wrap break-words rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="font-semibold">렌더 실패</div>
            <div className="mt-1 font-mono text-xs leading-relaxed">{error}</div>
          </div>
        )}

        {done && lastOutputPath && (
          <div className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <div className="font-semibold">완료!</div>
            <div className="mt-1 break-all font-mono text-xs">{lastOutputPath}</div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setScreen('editor')}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
          >
            ← 편집기로
          </button>
          {isRendering && !done && (
            <button
              onClick={() => api().cancelRender()}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-red-500/20"
            >
              ⨯ 렌더 취소
            </button>
          )}
          {done && lastOutputPath && (
            <>
              <button
                onClick={() => api().showItemInFolder(lastOutputPath)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
              >
                폴더 열기
              </button>
              <button
                onClick={() => api().openPath(lastOutputPath)}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-soft"
              >
                ▶ 재생
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'preparing':
      return '준비 중...';
    case 'rendering':
      return '렌더링 중...';
    case 'finalizing':
      return '마무리 중...';
    case 'done':
      return '완료!';
    case 'error':
      return '오류';
    case 'cancelled':
      return '취소됨';
    default:
      return stage;
  }
}
