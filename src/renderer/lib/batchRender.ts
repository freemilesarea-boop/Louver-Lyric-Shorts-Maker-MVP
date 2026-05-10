import type {
  AmplitudeCurve,
  CustomPreset,
  LanguageCode,
  LyricLine,
  LyricPosition,
  OverlayPng,
  Template,
} from '../../shared/types';
import type { FontKey } from '../../shared/fonts';
import { templates } from '../templates/templates';
import { SAMPLE_PRESETS } from '../samples/samplePresets';
import type { BatchItem } from '../store/projectStore';
import { api } from './api';
import { buildOverlays as defaultBuildOverlays } from './overlays';
import { prettyErrorMessage } from '../../shared/errors';

export type BatchPlanKind = 'sample-presets' | 'all-templates' | 'custom-presets';

/** Build the queue of BatchItems for a chosen plan. */
export function buildBatchPlan(
  kind: BatchPlanKind,
  detectedLanguage: LanguageCode,
  customPresets: CustomPreset[] = [],
): BatchItem[] {
  if (kind === 'sample-presets') {
    return SAMPLE_PRESETS.map((p): BatchItem => ({
      id: p.id,
      label: p.name,
      templateId: p.templateId,
      motionPreset: p.motionPreset,
      animationPreset: p.animationPreset,
      reactiveMode: p.reactiveMode,
      fxPreset: p.cinematicFxPreset,
      language: p.recommendedLanguage,
      status: 'pending',
    }));
  }
  if (kind === 'custom-presets') {
    return customPresets.map((p): BatchItem => ({
      id: p.id,
      label: p.name,
      templateId: p.templateId,
      motionPreset: p.motionPreset,
      animationPreset: p.animationPreset,
      reactiveMode: p.reactiveMode,
      fxPreset: p.cinematicFxPreset,
      language: p.language ?? detectedLanguage,
      status: 'pending',
    }));
  }
  // 'all-templates' — fall back to each template's defaults for motion /
  // animation / reactive / FX. Language follows the user's detected
  // language so the right font stack is picked.
  return templates.map((t: Template): BatchItem => ({
    id: t.id,
    label: t.name,
    templateId: t.id,
    motionPreset: t.motionPreset ?? 'none',
    animationPreset: t.animationPreset ?? 'none',
    reactiveMode: t.reactiveMode ?? 'none',
    fxPreset: t.cinematicFxPreset ?? 'none',
    language: detectedLanguage,
    status: 'pending',
  }));
}

export interface BatchInputs {
  imagePath: string;
  audioPath: string;
  lyrics: LyricLine[];
  startSec: number;
  durationSec: 15 | 30 | 60;
  highlightKorean: boolean;
  trackTitle?: string;
  artistName?: string;
  amplitudeCurve: AmplitudeCurve | null;
  outputDir: string;
  /** Bake karaoke word highlight into every batch item's overlays. */
  karaokeEnabled?: boolean;
  /** Auto-safe-position override applied to every batch item. */
  lyricPositionOverride?: LyricPosition | null;
  /** User-picked font (FontSelector). Applied to every batch item. */
  fontKey?: FontKey | null;
}

export interface BatchHooks {
  isCancelRequested(): boolean;
  onItemStart(idx: number): void;
  onItemProgress(idx: number, percent: number): void;
  onItemFinish(
    idx: number,
    result:
      | { ok: true; outputPath: string; timings?: import('../../shared/types').RenderTimings }
      | { ok: false; error: string },
  ): void;
  onItemSkip(idx: number): void;
  /**
   * Optional override of `buildOverlays`. Defaults to the real DOM-canvas
   * implementation; tests inject a stub so the orchestrator can be
   * exercised in plain Node without a canvas dependency.
   */
  buildOverlays?: (args: {
    item: BatchItem;
    template: Template;
    inputs: BatchInputs;
  }) => Promise<OverlayPng[]>;
}

/**
 * Run a queue of BatchItems sequentially. One item failing does NOT abort
 * the rest — failures are reported via onItemFinish and the loop continues
 * to the next item. Cancellation is checked between items and uses the
 * existing cancelRender IPC for the in-flight item.
 */
export async function runBatch(
  items: BatchItem[],
  inputs: BatchInputs,
  hooks: BatchHooks,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (hooks.isCancelRequested()) {
      // Mark every remaining item as skipped and bail.
      for (let j = i; j < items.length; j++) hooks.onItemSkip(j);
      return;
    }
    const item = items[i];
    hooks.onItemStart(i);

    try {
      const tpl = templates.find((t) => t.id === item.templateId) ?? templates[0];
      // Bake overlays for this item (animation + reactive + FX vary).
      const overlays = hooks.buildOverlays
        ? await hooks.buildOverlays({ item, template: tpl, inputs })
        : await defaultBuildOverlays({
            lyrics: inputs.lyrics,
            template: tpl,
            language: item.language,
            animationPreset: item.animationPreset,
            reactiveMode: item.reactiveMode,
            amplitudeCurve: inputs.amplitudeCurve,
            fxPreset: item.fxPreset,
            highlightSub: inputs.highlightKorean,
            durationSec: inputs.durationSec,
            trackTitle: inputs.trackTitle,
            artistName: inputs.artistName,
            karaokeEnabled: inputs.karaokeEnabled,
            lyricPositionOverride: inputs.lyricPositionOverride ?? null,
            fontKey: inputs.fontKey ?? null,
          });

      const result = await api().startRender({
        imagePath: inputs.imagePath,
        audioPath: inputs.audioPath,
        lyrics: inputs.lyrics,
        template: tpl,
        startSec: inputs.startSec,
        durationSec: inputs.durationSec,
        trackTitle: inputs.trackTitle,
        artistName: inputs.artistName,
        highlightKorean: inputs.highlightKorean,
        outputPath: inputs.outputDir,
        overlays,
        motionPreset: item.motionPreset,
        animationPreset: item.animationPreset,
        reactiveMode: item.reactiveMode,
        amplitudeCurve: inputs.amplitudeCurve,
        fxPreset: item.fxPreset,
        nameTag: item.id,
      });

      if (result.ok && result.outputPath) {
        hooks.onItemFinish(i, {
          ok: true,
          outputPath: result.outputPath,
          timings: result.timings,
        });
      } else {
        hooks.onItemFinish(i, {
          ok: false,
          error: prettyErrorMessage(result.error ?? 'Unknown error'),
        });
      }
    } catch (e) {
      hooks.onItemFinish(i, { ok: false, error: prettyErrorMessage(e) });
    }
  }
}
