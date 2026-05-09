interface Props {
  audioPath: string | null;
  audioDataUrl: string | null;
  audioDurationSec: number;
  startSec: number;
  durationSec: 15 | 30 | 60;
  onChangeStart: (s: number) => void;
  onChangeDuration: (d: 15 | 30 | 60) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onPreviewPlay: () => void;
}

export default function AudioRangeSelector(props: Props): JSX.Element {
  const total = Math.max(0, props.audioDurationSec);
  const max = Math.max(0, total - props.durationSec);

  return (
    <div>
      {!props.audioPath && (
        <div className="text-xs text-white/40">먼저 Start 화면에서 오디오를 업로드하세요.</div>
      )}
      {props.audioPath && (
        <>
          {props.audioDataUrl && (
            <audio
              ref={props.audioRef}
              src={props.audioDataUrl}
              preload="metadata"
              className="hidden"
            />
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[15, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => {
                  props.onChangeDuration(d as 15 | 30 | 60);
                  if (props.startSec > Math.max(0, total - d)) {
                    props.onChangeStart(Math.max(0, total - d));
                  }
                }}
                className={[
                  'rounded-full px-3 py-1 text-xs font-medium',
                  props.durationSec === d
                    ? 'bg-accent text-ink-950'
                    : 'bg-white/10 hover:bg-white/15',
                ].join(' ')}
              >
                {d}s
              </button>
            ))}
            <button
              onClick={props.onPreviewPlay}
              className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
            >
              ▶ 구간 미리듣기
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-white/60">
            <span className="font-mono">{fmt(props.startSec)}</span>
            <input
              type="range"
              min={0}
              max={max}
              step={0.1}
              value={Math.min(props.startSec, max)}
              onChange={(e) => props.onChangeStart(parseFloat(e.target.value))}
              className="flex-1 accent-yellow-300"
            />
            <span className="font-mono">{fmt(props.startSec + props.durationSec)}</span>
          </div>
          <div className="mt-1 text-right text-[11px] text-white/40">
            전체 {fmt(total)}
          </div>
        </>
      )}
    </div>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
