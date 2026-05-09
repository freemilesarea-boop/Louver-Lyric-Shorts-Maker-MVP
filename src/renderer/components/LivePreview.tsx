import { useEffect, useState } from 'react';
import type { LyricLine, Template } from '../../shared/types';

interface Props {
  imageDataUrl: string | null;
  template: Template;
  lyrics: LyricLine[];
  highlightKorean: boolean;
  trackTitle?: string;
  artistName?: string;
  durationSec: number;
}

/**
 * In-app HTML/CSS preview that mimics the ffmpeg output.
 * It is NOT a 1:1 frame-accurate preview — it exists for layout/font/color
 * iteration. The authoritative render is the ffmpeg pipeline.
 */
export default function LivePreview(props: Props): JSX.Element {
  const visible = props.lyrics.filter((l) => (l.text || '').trim() || (l.ko || '').trim());
  const [tick, setTick] = useState(0);

  // Cycle through lyric lines so the preview feels alive.
  useEffect(() => {
    if (visible.length === 0) return;
    const slice = (props.durationSec * 1000) / visible.length;
    const id = setInterval(() => setTick((n) => (n + 1) % visible.length), Math.max(800, slice));
    return () => clearInterval(id);
  }, [visible.length, props.durationSec]);

  const current = visible[tick] ?? null;
  const t = props.template;

  const lyricVerticalClass =
    t.lyricPosition === 'top'
      ? 'items-start pt-[7%]'
      : t.lyricPosition === 'center'
        ? 'items-center'
        : 'items-end pb-[16%]';

  const lyricAlignClass =
    t.lyricAlign === 'left' ? 'text-left' : t.lyricAlign === 'right' ? 'text-right' : 'text-center';

  const bgFilterClass = (() => {
    switch (t.backgroundEffect) {
      case 'blur':
        return 'blur-2xl brightness-95';
      case 'darken':
        return 'blur-md brightness-50';
      case 'sepia':
        return 'blur-lg sepia brightness-95';
      case 'none':
      default:
        return 'blur-sm';
    }
  })();

  return (
    <div
      className="relative overflow-hidden rounded-2xl shadow-2xl"
      style={{
        aspectRatio: '9 / 16',
        height: '100%',
        maxHeight: '100%',
        backgroundColor: t.cardBg,
      }}
    >
      {/* Background layer */}
      {props.imageDataUrl ? (
        <img
          src={props.imageDataUrl}
          className={`absolute inset-0 h-full w-full object-cover ${bgFilterClass}`}
          alt=""
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />
      )}

      {/* Tint */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: t.cardBg, opacity: t.overlayOpacity * 0.25 }}
      />

      {/* Foreground card */}
      <div className="absolute inset-0 flex items-center justify-center">
        {props.imageDataUrl && (
          <img
            src={props.imageDataUrl}
            alt=""
            className="rounded-xl object-contain shadow-2xl"
            style={{ width: '86%', height: '62%', objectFit: 'contain', marginTop: '-6%' }}
          />
        )}
      </div>

      {/* Lyrics */}
      <div className={`absolute inset-0 flex justify-center ${lyricVerticalClass}`}>
        <div className={`px-8 max-w-[92%] ${lyricAlignClass}`} style={{ width: '100%' }}>
          {current?.text ? (
            <div
              className="leading-tight"
              style={{
                color: t.lyricColor,
                fontWeight: t.fontWeight,
                fontSize: `${t.fontSize * 0.4}px`,
                textShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
            >
              {current.text}
            </div>
          ) : null}
          {current?.ko ? (
            <div
              className="mt-2 leading-tight"
              style={{
                color: props.highlightKorean ? t.lyricSubColor : t.lyricColor,
                fontWeight: 500,
                fontSize: `${t.fontSize * 0.32}px`,
                textShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
            >
              {current.ko}
            </div>
          ) : null}
        </div>
      </div>

      {/* Track meta */}
      {(props.trackTitle || props.artistName) && (
        <div className="absolute left-0 right-0 px-8 text-center" style={{ top: '78%' }}>
          {props.trackTitle && (
            <div
              className="font-semibold"
              style={{ color: t.lyricColor, fontSize: 16 }}
            >
              {props.trackTitle}
            </div>
          )}
          {props.artistName && (
            <div className="opacity-70" style={{ color: t.lyricColor, fontSize: 12 }}>
              {props.artistName}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {t.progressBarStyle !== 'none' && (
        <div
          className="absolute left-0 right-0 mx-auto"
          style={{ bottom: '10%', width: '85%' }}
        >
          <div
            className="overflow-hidden"
            style={{
              backgroundColor: hexWithAlpha(t.lyricColor, 0.25),
              height: t.progressBarStyle === 'thick' ? 5 : 3,
              borderRadius: t.progressBarStyle === 'rounded' ? 999 : 2,
            }}
          >
            <div
              className="h-full"
              style={{
                width: `${((tick + 1) / Math.max(1, visible.length)) * 100}%`,
                backgroundColor: t.lyricColor,
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Play icon */}
      {t.showPlayerControl && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: '5%' }}>
          <div
            className="grid h-10 w-10 place-items-center rounded-full"
            style={{ backgroundColor: hexWithAlpha(t.lyricColor, 0.15) }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: '7px solid transparent',
                borderBottom: '7px solid transparent',
                borderLeft: `12px solid ${t.lyricColor}`,
                marginLeft: 3,
              }}
            />
          </div>
        </div>
      )}

      {/* Faux waveform */}
      {t.showWaveform && (
        <div
          className="absolute left-0 right-0 mx-auto flex items-end justify-between"
          style={{ bottom: '15%', width: '78%', height: '8%' }}
        >
          {Array.from({ length: 32 }).map((_, i) => {
            const seed = (i * 37) % 100;
            const h = 25 + (seed % 60) + 10 * Math.sin(tick + i * 0.7);
            return (
              <div
                key={i}
                style={{
                  width: 3,
                  height: `${Math.max(8, Math.min(80, h))}%`,
                  backgroundColor: hexWithAlpha(t.lyricColor, 0.85),
                  borderRadius: 2,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
