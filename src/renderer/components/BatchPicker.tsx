import { useState } from 'react';
import {
  useProjectStore,
  type BatchItem,
} from '../store/projectStore';
import { api } from '../lib/api';
import {
  buildBatchPlan,
  runBatch,
  type BatchPlanKind,
} from '../lib/batchRender';
import { prettyErrorMessage } from '../../shared/errors';
import { templates } from '../templates/templates';
import { SAMPLE_PRESETS } from '../samples/samplePresets';

/**
 * Two-button batch picker. Each click:
 *   1. Validates inputs (image, audio, lyrics).
 *   2. Builds the queue from the chosen plan.
 *   3. Resolves outputDir + amplitudeCurve.
 *   4. Navigates to the export screen and kicks off `runBatch`.
 *
 * The orchestrator updates the store as items progress so ExportScreen
 * can live-render the queue without owning the loop.
 */
export default function BatchPicker(): JSX.Element {
  const state = useProjectStore();
  const [error, setError] = useState<string | null>(null);

  const start = async (kind: BatchPlanKind) => {
    setError(null);
    if (!state.imagePath || !state.audioPath) {
      setError('이미지와 오디오를 먼저 업로드해주세요.');
      return;
    }
    if (state.parsedLyrics.length === 0) {
      const ok = window.confirm(
        '가사가 비어 있습니다. 자막 없이 모든 항목을 렌더할까요?',
      );
      if (!ok) return;
    }

    let outputDir = state.outputDir;
    if (!outputDir) {
      try {
        outputDir = await api().defaultOutputDir();
      } catch (e) {
        setError(prettyErrorMessage(e));
        return;
      }
      state.setOutputDir(outputDir);
    }

    const items: BatchItem[] = buildBatchPlan(kind, state.detectedLanguage);
    state.startBatch(items);
    state.setLastError(null);
    state.setIsRendering(true);
    state.setScreen('export');

    runBatch(
      items,
      {
        imagePath: state.imagePath,
        audioPath: state.audioPath,
        lyrics: state.parsedLyrics,
        startSec: state.startSec,
        durationSec: state.durationSec,
        highlightKorean: state.highlightKorean,
        trackTitle: state.trackTitle,
        artistName: state.artistName,
        amplitudeCurve: state.amplitudeCurve,
        outputDir,
      },
      {
        isCancelRequested: () => useProjectStore.getState().batchCancelRequested,
        onItemStart: (i) => {
          state.setBatchActiveIdx(i);
          state.updateBatchItem(i, { status: 'rendering', progressPercent: 0 });
        },
        onItemProgress: (i, percent) => {
          state.updateBatchItem(i, { progressPercent: percent });
        },
        onItemFinish: (i, result) => {
          if (result.ok) {
            state.updateBatchItem(i, {
              status: 'done',
              progressPercent: 100,
              outputPath: result.outputPath,
              timings: result.timings,
            });
          } else {
            state.updateBatchItem(i, {
              status: 'failed',
              error: result.error,
            });
          }
        },
        onItemSkip: (i) => {
          state.updateBatchItem(i, { status: 'skipped' });
        },
      },
    )
      .catch((e) => {
        // Should not reach here — runBatch swallows per-item errors and
        // surfaces them via onItemFinish. But just in case.
        state.setLastError(prettyErrorMessage(e));
      })
      .finally(() => {
        state.finishBatch();
        state.setIsRendering(false);
      });
  };

  const sampleCount = SAMPLE_PRESETS.length;
  const templateCount = templates.length;

  const btnCls =
    'flex flex-1 flex-col items-start gap-1 rounded-lg border border-white/10 ' +
    'bg-ink-800/60 px-3 py-2.5 text-left transition-colors ' +
    'hover:border-white/30 hover:bg-ink-800 disabled:cursor-not-allowed ' +
    'disabled:opacity-50';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => start('sample-presets')}
          disabled={state.isRendering}
          className={btnCls}
        >
          <div className="text-sm font-semibold">📦 Sample Preset {sampleCount}개로 생성</div>
          <div className="text-[11px] text-white/60">
            큐레이션된 무드 번들 ({SAMPLE_PRESETS.map((p) => p.name).slice(0, 3).join(', ')} 외)
          </div>
        </button>
        <button
          onClick={() => start('all-templates')}
          disabled={state.isRendering}
          className={btnCls}
        >
          <div className="text-sm font-semibold">🎨 전체 템플릿 {templateCount}개로 생성</div>
          <div className="text-[11px] text-white/60">
            10개 템플릿 × 각 템플릿 기본 motion / animation / reactive / FX
          </div>
        </button>
      </div>
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
