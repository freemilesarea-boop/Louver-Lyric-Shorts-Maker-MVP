import { useProjectStore } from '../store/projectStore';
import type { LyricLine } from '../../shared/types';

interface Props {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

/**
 * Per-line timeline editor. Each parsed lyric line gets a row with start/end
 * inputs, a "set start to current playback" button, and a quick play-from-here.
 *
 * Time values are CLIP-LOCAL (seconds within the chosen clip duration), not
 * absolute audio file time. Audio playback uses startSec + line.start when
 * jumping.
 */
export default function LyricTimeline(props: Props): JSX.Element {
  const lines = useProjectStore((s) => s.parsedLyrics);
  const duration = useProjectStore((s) => s.durationSec);
  const startSec = useProjectStore((s) => s.startSec);
  const updateLyricTiming = useProjectStore((s) => s.updateLyricTiming);
  const redistribute = useProjectStore((s) => s.redistributeLyricsEvenly);

  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
        가사를 입력하면 줄별 타임라인이 여기에 나타나요.
      </div>
    );
  }

  const onSetStartFromAudio = (i: number) => {
    const a = props.audioRef.current;
    if (!a) return;
    const localT = Math.max(0, a.currentTime - startSec);
    if (localT > duration) return;
    updateLyricTiming(i, { start: round2(localT) });
  };

  const onPlayFromLine = (line: LyricLine) => {
    const a = props.audioRef.current;
    if (!a) return;
    a.currentTime = startSec + Math.max(0, line.start ?? 0);
    a.play();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50">
          {lines.length} lines · 클립 0:00 ~ {fmt(duration)}
        </span>
        <button
          onClick={redistribute}
          className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] hover:bg-white/15"
        >
          ⟳ 균등 분배
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border border-white/5 bg-ink-800/50">
        {lines.map((line, i) => (
          <TimelineRow
            key={i}
            index={i}
            line={line}
            duration={duration}
            onChangeStart={(v) => updateLyricTiming(i, { start: v })}
            onChangeEnd={(v) => updateLyricTiming(i, { end: v })}
            onSetStartFromAudio={() => onSetStartFromAudio(i)}
            onPlayFromHere={() => onPlayFromLine(line)}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  index: number;
  line: LyricLine;
  duration: number;
  onChangeStart: (v: number) => void;
  onChangeEnd: (v: number) => void;
  onSetStartFromAudio: () => void;
  onPlayFromHere: () => void;
}

function TimelineRow(p: RowProps): JSX.Element {
  const start = p.line.start ?? 0;
  const end = p.line.end ?? 0;
  const overflow = end > p.duration;
  const inverted = end <= start;

  return (
    <div
      className={[
        'flex items-center gap-2 border-b border-white/5 px-2 py-2 text-xs last:border-b-0',
        overflow || inverted ? 'bg-red-500/10' : '',
      ].join(' ')}
    >
      <span className="w-6 shrink-0 text-right font-mono text-white/40">
        {p.index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={p.line.text}>
          {p.line.text || <span className="text-white/40">(no en)</span>}
        </div>
        {p.line.ko && (
          <div className="truncate text-white/60" title={p.line.ko}>
            {p.line.ko}
          </div>
        )}
      </div>
      <TimeInput value={start} onChange={p.onChangeStart} />
      <span className="text-white/30">→</span>
      <TimeInput value={end} onChange={p.onChangeEnd} />
      <button
        onClick={p.onSetStartFromAudio}
        title="현재 재생 위치를 이 줄 시작으로"
        className="rounded bg-white/10 px-1.5 py-1 text-[10px] hover:bg-white/15"
      >
        ⏱
      </button>
      <button
        onClick={p.onPlayFromHere}
        title="이 줄부터 재생"
        className="rounded bg-white/10 px-1.5 py-1 text-[10px] hover:bg-white/15"
      >
        ▶
      </button>
    </div>
  );
}

function TimeInput(props: { value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <input
      type="number"
      step={0.1}
      min={0}
      value={Number.isFinite(props.value) ? props.value : 0}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) props.onChange(round2(v));
      }}
      className="w-16 rounded border border-white/10 bg-ink-900 px-1 py-0.5 text-right font-mono text-[11px] tabular-nums focus:border-white/40 focus:outline-none"
    />
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
