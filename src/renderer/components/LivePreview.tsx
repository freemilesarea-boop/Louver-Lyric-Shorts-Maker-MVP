import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnimationPreset,
  LanguageCode,
  LyricLine,
  MotionPreset,
  Template,
} from '../../shared/types';
import { renderScene, SCENE_W, SCENE_H } from '../../shared/scene';
import { isStaticMotion } from '../../shared/motion';
import {
  REST_STATE,
  animationStateAt,
  isStaticAnimation,
} from '../../shared/animation';
import { sliceLyrics } from '../lib/overlays';

interface Props {
  imageDataUrl: string | null;
  template: Template;
  language: LanguageCode;
  lyrics: LyricLine[];
  highlightSub: boolean;
  trackTitle?: string;
  artistName?: string;
  durationSec: number;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  forcedChunkIndex?: number | null;
}

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;

/**
 * Canvas-based preview that renders at full 1080×1920 internally and uses CSS
 * to scale into its container.
 *
 * The preview keeps a continuous time loop that drives BOTH motion (which
 * cycles over the full duration) and lyric animation (which is sampled per
 * chunk). The same shared scene renderer also powers the export overlay
 * generator, so what shows here is what ships.
 */
export default function LivePreview(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [tNowSec, setTNowSec] = useState(0);

  useEffect(() => {
    if (!props.imageDataUrl) {
      setPhoto(null);
      return;
    }
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => setPhoto(null);
    img.src = props.imageDataUrl;
  }, [props.imageDataUrl]);

  // Compute clip-relative chunk windows once per inputs change.
  const chunks = useMemo(
    () => sliceLyrics(props.lyrics, props.durationSec),
    [props.lyrics, props.durationSec],
  );

  // Continuous time loop: tNowSec ranges over [0, durationSec) and drives
  // every animated layer (motion, lyric animation, progress, waveform).
  useEffect(() => {
    if (props.durationSec <= 0) return;
    const animationsActive =
      !isStaticAnimation(props.animationPreset) ||
      !isStaticMotion(props.motionPreset) ||
      props.template.showWaveform ||
      props.template.progressBarStyle !== 'none' ||
      chunks.length > 1;
    if (!animationsActive) {
      setTNowSec(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    let last = 0;
    const step = (now: number) => {
      if (now - last >= PREVIEW_FRAME_INTERVAL_MS) {
        const elapsed = (now - start) / 1000;
        const t = elapsed % props.durationSec;
        setTNowSec(t);
        last = now;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    props.durationSec,
    props.motionPreset,
    props.animationPreset,
    props.template.showWaveform,
    props.template.progressBarStyle,
    chunks.length,
  ]);

  // Pick the chunk active at tNowSec (or use forcedChunkIndex when scrubbing).
  const activeIdx = useMemo(() => {
    if (props.forcedChunkIndex != null) {
      return Math.max(0, Math.min(chunks.length - 1, props.forcedChunkIndex));
    }
    if (chunks.length === 0) return -1;
    for (let i = 0; i < chunks.length; i++) {
      if (tNowSec >= chunks[i].start && tNowSec < chunks[i].end) return i;
    }
    // Past the last chunk — keep showing it during exit.
    return chunks.length - 1;
  }, [chunks, tNowSec, props.forcedChunkIndex]);

  const currentLyric = activeIdx >= 0 ? chunks[activeIdx].line : null;

  // Compute animation state at this moment of the active chunk.
  const animState = useMemo(() => {
    if (activeIdx < 0) return REST_STATE;
    const chunk = chunks[activeIdx];
    const dur = Math.max(0, chunk.end - chunk.start);
    const tInChunk = tNowSec - chunk.start;
    return animationStateAt(props.animationPreset, dur, tInChunk);
  }, [activeIdx, chunks, tNowSec, props.animationPreset]);

  const timeRatio = props.durationSec > 0 ? tNowSec / props.durationSec : 0;

  // Repaint on every state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    renderScene(ctx, {
      width: SCENE_W,
      height: SCENE_H,
      template: props.template,
      language: props.language,
      highlightSub: props.highlightSub,
      exportMode: false,
      lyric: currentLyric,
      trackTitle: props.trackTitle,
      artistName: props.artistName,
      photo,
      timeRatio,
      motionPreset: props.motionPreset,
      animation: animState,
    });
  }, [
    photo,
    currentLyric,
    props.template,
    props.language,
    props.highlightSub,
    props.trackTitle,
    props.artistName,
    props.motionPreset,
    timeRatio,
    animState,
  ]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-h-full max-w-full rounded-2xl shadow-2xl"
        style={{ aspectRatio: '9 / 16', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
