import { useProjectStore, type BatchItem } from '../store/projectStore';
import { api } from '../lib/api';

export default function ExportScreen(): JSX.Element {
  const batchItems = useProjectStore((s) => s.batchItems);
  const isBatch = batchItems.length > 1;
  return isBatch ? <BatchView /> : <SingleView />;
}

/* ============================ single render view ============================ */

function SingleView(): JSX.Element {
  const progress = useProjectStore((s) => s.lastRenderProgress);
  const isRendering = useProjectStore((s) => s.isRendering);
  const lastOutputPath = useProjectStore((s) => s.lastOutputPath);
  const lastError = useProjectStore((s) => s.lastError);
  const lastTimings = useProjectStore((s) => s.lastRenderTimings);
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
            {lastTimings && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-emerald-200/80">
                <div>Total <span className="font-mono text-emerald-100">{(lastTimings.totalMs / 1000).toFixed(1)}s</span></div>
                <div>ffmpeg <span className="font-mono text-emerald-100">{(lastTimings.ffmpegMs / 1000).toFixed(1)}s</span></div>
                <div>Overlay bake <span className="font-mono text-emerald-100">{lastTimings.overlayMaterializeMs}ms</span></div>
                <div>Keyframes <span className="font-mono text-emerald-100">{lastTimings.overlayCount}</span></div>
                <div className="col-span-2">File size <span className="font-mono text-emerald-100">{(lastTimings.outputSizeBytes / 1024 / 1024).toFixed(2)} MB</span></div>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => setScreen('editor')} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            ← 편집기로
          </button>
          {isRendering && !done && (
            <button onClick={() => api().cancelRender()} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-red-500/20">
              ⨯ 렌더 취소
            </button>
          )}
          {done && lastOutputPath && (
            <>
              <button onClick={() => api().showItemInFolder(lastOutputPath)} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
                폴더 열기
              </button>
              <button onClick={() => api().openPath(lastOutputPath)} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-soft">
                ▶ 재생
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== batch view ============================== */

function BatchView(): JSX.Element {
  const items = useProjectStore((s) => s.batchItems);
  const activeIdx = useProjectStore((s) => s.batchActiveIdx);
  const cancelRequested = useProjectStore((s) => s.batchCancelRequested);
  const startedAt = useProjectStore((s) => s.batchStartedAt);
  const finishedAt = useProjectStore((s) => s.batchFinishedAt);
  const isRendering = useProjectStore((s) => s.isRendering);
  const requestBatchCancel = useProjectStore((s) => s.requestBatchCancel);
  const setScreen = useProjectStore((s) => s.setScreen);
  const outputDir = useProjectStore((s) => s.outputDir);

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const finished = !!finishedAt && !isRendering;
  const overall = items.length > 0 ? ((done + failed + skipped) / items.length) * 100 : 0;
  const elapsedMs =
    startedAt != null ? (finishedAt ?? Date.now()) - startedAt : 0;

  const onCancel = () => {
    requestBatchCancel();
    api().cancelRender(); // abort the in-flight item too
  };

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-ink-900 p-7">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">배치 출력</h1>
          <div className="text-xs text-white/60">
            {done + failed + skipped} / {items.length} 완료
            {failed > 0 && <span className="ml-2 text-red-300">({failed} 실패)</span>}
            {skipped > 0 && <span className="ml-2 text-white/40">({skipped} 건너뜀)</span>}
          </div>
        </div>

        {/* overall progress */}
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${overall}%` }}
            />
          </div>
        </div>

        {/* per-item list */}
        <ul className="mt-5 flex-1 overflow-y-auto rounded-lg border border-white/5 bg-ink-800/50 divide-y divide-white/5">
          {items.map((item, i) => (
            <BatchRow key={item.id + i} item={item} active={i === activeIdx && isRendering} />
          ))}
        </ul>

        {/* summary */}
        {finished && (
          <div className="mt-5 rounded-md border border-white/10 bg-ink-800/60 px-4 py-3 text-sm">
            <div className="font-semibold text-white">배치 완료</div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/70 sm:grid-cols-4">
              <div>생성 <span className="font-mono text-emerald-300">{done}</span></div>
              <div>실패 <span className="font-mono text-red-300">{failed}</span></div>
              {skipped > 0 && <div>건너뜀 <span className="font-mono">{skipped}</span></div>}
              <div>소요 <span className="font-mono">{(elapsedMs / 1000).toFixed(1)}s</span></div>
            </div>
            {failed > 0 && (
              <div className="mt-2 text-[11px] text-red-300">
                실패한 항목은 위 목록에서 사유를 확인할 수 있어요.
              </div>
            )}
          </div>
        )}

        {/* footer actions */}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => setScreen('editor')} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            ← 편집기로
          </button>
          {isRendering && !cancelRequested && (
            <button onClick={onCancel} className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-red-500/20">
              ⨯ 배치 취소
            </button>
          )}
          {finished && outputDir && (
            <button onClick={() => api().openPath(outputDir)} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-soft">
              📁 폴더 열기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchRow(props: { item: BatchItem; active: boolean }): JSX.Element {
  const { item, active } = props;
  const statusBadge = (() => {
    switch (item.status) {
      case 'pending':
        return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">대기</span>;
      case 'rendering':
        return <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">렌더 중 · {Math.round(item.progressPercent ?? 0)}%</span>;
      case 'done':
        return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">완료</span>;
      case 'failed':
        return <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">실패</span>;
      case 'skipped':
        return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">건너뜀</span>;
    }
  })();
  return (
    <li className={['flex items-start gap-3 px-3 py-2 text-sm', active ? 'bg-accent/5' : ''].join(' ')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.label}</span>
          {statusBadge}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-white/40">
          {item.templateId} · motion={item.motionPreset} · anim={item.animationPreset}
        </div>
        {item.outputPath && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-emerald-200/70" title={item.outputPath}>
            {item.outputPath}
          </div>
        )}
        {item.error && (
          <div className="mt-1 break-words text-[11px] text-red-300">{item.error}</div>
        )}
      </div>
      {item.status === 'done' && item.outputPath && (
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => api().showItemInFolder(item.outputPath!)}
            className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/15"
            title="폴더에서 보기"
          >
            폴더
          </button>
          <button
            onClick={() => api().openPath(item.outputPath!)}
            className="rounded bg-accent/30 px-2 py-0.5 text-[10px] text-accent hover:bg-accent/50"
            title="재생"
          >
            ▶
          </button>
        </div>
      )}
    </li>
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
