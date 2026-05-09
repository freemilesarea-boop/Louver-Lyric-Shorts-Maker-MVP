import { useEffect, useRef, useState } from 'react';
import type { LanguageCode, LyricLine, MotionPreset, Template } from '../../shared/types';
import { renderScene, SCENE_W, SCENE_H } from '../../shared/scene';
import { isStaticMotion } from '../../shared/motion';

interface Props {
  imageDataUrl: string | null;
  template: Template;
  language: LanguageCode;
  lyrics: LyricLine[];
  highlightSub: boolean;
  trackTitle?: string;
  artistName?: string;
  durationSec: number;
  /** Effective motion preset (template default OR user override). */
  motionPreset: MotionPreset;
  /** Optional override of which line to show (for timeline scrubbing). */
  forcedChunkIndex?: number | null;
}

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 24; // 24fps preview repaint

/**
 * Canvas-based preview that renders at full 1080×1920 internally and uses CSS
 * to scale into its container. Because the export overlay generator uses the
 * same shared scene renderer, what you see is what you ship.
 *
 * The preview keeps a continuous time loop so motion presets play back
 * smoothly. Lyric chunk cycling is decoupled from the time loop.
 */
export default function LivePreview(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [timeRatio, setTimeRatio] = useState(0);

  // Load photo into an HTMLImageElement so canvas can drawImage it.
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

  const visible = props.lyrics.filter(
    (l) => (l.text && l.text.trim()) || (l.ko && l.ko.trim()),
  );

  // Cycle through visible lyric chunks (independent of motion ratio).
  useEffect(() => {
    if (visible.length <= 1) {
      setChunkIndex(0);
      return;
    }
    const slice = (props.durationSec * 1000) / Math.max(1, visible.length);
    const id = window.setInterval(
      () => setChunkIndex((n) => (n + 1) % visible.length),
      Math.max(800, slice),
    );
    return () => window.clearInterval(id);
  }, [visible.length, props.durationSec]);

  // Continuous time loop for motion + animated chrome.
  useEffect(() => {
    if (props.durationSec <= 0) return;
    if (isStaticMotion(props.motionPreset) && !props.template.showWaveform && props.template.progressBarStyle === 'none') {
      // Nothing animated to drive — leave timeRatio at 0.
      setTimeRatio(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    let last = 0;
    const step = (now: number) => {
      if (now - last >= PREVIEW_FRAME_INTERVAL_MS) {
        const elapsed = (now - start) / 1000;
        const ratio = (elapsed % props.durationSec) / props.durationSec;
        setTimeRatio(ratio);
        last = now;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    props.durationSec,
    props.motionPreset,
    props.template.showWaveform,
    props.template.progressBarStyle,
  ]);

  const idx =
    props.forcedChunkIndex != null
      ? Math.max(0, Math.min(visible.length - 1, props.forcedChunkIndex))
      : chunkIndex % Math.max(1, visible.length);
  const currentLyric = visible[idx] ?? null;

  // Repaint whenever any input or animation tick changes.
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
