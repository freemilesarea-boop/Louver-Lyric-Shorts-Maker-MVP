import { useEffect, useRef, useState } from 'react';
import type { LanguageCode, LyricLine, Template } from '../../shared/types';
import { renderScene, SCENE_W, SCENE_H } from '../../shared/scene';

interface Props {
  imageDataUrl: string | null;
  template: Template;
  language: LanguageCode;
  lyrics: LyricLine[];
  highlightSub: boolean;
  trackTitle?: string;
  artistName?: string;
  durationSec: number;
  /** Optional override of which line to show (for timeline scrubbing). */
  forcedChunkIndex?: number | null;
}

/**
 * Canvas-based preview that renders at full 1080×1920 internally and uses CSS
 * to scale into its container. Because the export overlay generator uses the
 * same shared scene renderer, what you see is what you ship.
 */
export default function LivePreview(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [tick, setTick] = useState(0);

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

  // Cycle through visible lyric chunks.
  const visible = props.lyrics.filter(
    (l) => (l.text && l.text.trim()) || (l.ko && l.ko.trim()),
  );

  useEffect(() => {
    if (visible.length <= 1) return;
    const slice = (props.durationSec * 1000) / Math.max(1, visible.length);
    const id = window.setInterval(
      () => setTick((n) => (n + 1) % visible.length),
      Math.max(800, slice),
    );
    return () => window.clearInterval(id);
  }, [visible.length, props.durationSec]);

  const idx =
    props.forcedChunkIndex != null
      ? Math.max(0, Math.min(visible.length - 1, props.forcedChunkIndex))
      : tick % Math.max(1, visible.length);
  const currentLyric = visible[idx] ?? null;
  const timeRatio = visible.length > 0 ? (idx + 1) / visible.length : 0;

  // Repaint whenever any input changes.
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
    });
  }, [
    photo,
    currentLyric,
    props.template,
    props.language,
    props.highlightSub,
    props.trackTitle,
    props.artistName,
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
