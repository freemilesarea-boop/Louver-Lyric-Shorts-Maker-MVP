import { useEffect, useState } from 'react';

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

/**
 * Audio range picker — Phase 5-6 redesigned around explicit start /
 * end / 사용 길이 display so the user always sees the actual mm:ss
 * window the render will use.
 *
 * Inputs: mm:ss text fields for start (with parsing), a slider tied to
 * startSec, and the existing 15s / 30s / 60s quick buttons for length
 * (durationSec is still constrained to the legacy `15 | 30 | 60` type
 * so RenderRequest / BatchInputs / CustomPreset don't need a sweeping
 * refactor — arbitrary-length export is a Phase 5-7 follow-up).
 *
 * Sub-note: AI lyric extraction (TranscribeButton) already reads
 * startSec + durationSec from the store, so it analyzes exactly this
 * selected window. The note below the picker calls that out so the
 * user knows the buttons are connected.
 */
export default function AudioRangeSelector(props: Props): JSX.Element {
  const total = Math.max(0, props.audioDurationSec);
  const sliderMax = Math.max(0, total - props.durationSec);
  const endSec = Math.min(total, props.startSec + props.durationSec);

  // Local string state for the mm:ss text input so the user can edit
  // freely (typing "0:" without it snapping back). On blur / Enter we
  // parse and commit.
  const [startText, setStartText] = useState(fmt(props.startSec));
  useEffect(() => {
    setStartText(fmt(props.startSec));
  }, [props.startSec]);

  const commitStartText = (raw: string) => {
    const parsed = parseMmSs(raw);
    if (parsed == null) {
      setStartText(fmt(props.startSec));
      return;
    }
    const clamped = Math.max(0, Math.min(sliderMax, parsed));
    props.onChangeStart(clamped);
  };

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

          {/* Quick length buttons + preview play. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-white/50">길이</span>
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
                {d}초
              </button>
            ))}
            <button
              onClick={props.onPreviewPlay}
              className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
            >
              ▶ 구간 미리듣기
            </button>
          </div>

          {/* Explicit start / end / 사용 길이 display. */}
          <div className="mb-2 grid grid-cols-3 gap-2 rounded-md border border-white/5 bg-ink-800/40 p-2 text-[11px]">
            <Field label="시작">
              <input
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                onBlur={(e) => commitStartText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitStartText((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                inputMode="numeric"
                placeholder="0:00"
                className="w-full rounded-md border border-white/10 bg-ink-900 px-1.5 py-0.5 text-center font-mono text-xs focus:border-white/40 focus:outline-none"
              />
            </Field>
            <Field label="종료">
              <div className="rounded-md border border-white/5 bg-ink-900/60 px-1.5 py-0.5 text-center font-mono text-xs text-white/70">
                {fmt(endSec)}
              </div>
            </Field>
            <Field label="사용 길이">
              <div className="rounded-md border border-white/5 bg-ink-900/60 px-1.5 py-0.5 text-center font-mono text-xs text-white/70">
                {props.durationSec}초
              </div>
            </Field>
          </div>

          {/* Slider — kept in sync with the text field both directions. */}
          <div className="flex items-center gap-2 text-[11px] text-white/60">
            <span className="font-mono w-10 shrink-0 text-right">{fmt(props.startSec)}</span>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={0.1}
              value={Math.min(props.startSec, sliderMax)}
              onChange={(e) => props.onChangeStart(parseFloat(e.target.value))}
              className="flex-1 accent-yellow-300"
              aria-label="시작 위치 슬라이더"
            />
            <span className="font-mono w-10 shrink-0">{fmt(endSec)}</span>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/40">
            <span>전체 {fmt(total)}</span>
            <span>이 구간이 AI 가사 추출에도 사용됩니다.</span>
          </div>
        </>
      )}
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{props.label}</div>
      {props.children}
    </div>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Parses a free-form time string. Accepts:
 *   - "1:42"      → 102
 *   - "0:42"      → 42
 *   - "42"        → 42  (raw seconds)
 *   - "1:42.5"    → 102.5
 *   - "1: 42"     → 102 (whitespace OK)
 * Returns null when nothing sensible parses out.
 */
function parseMmSs(raw: string): number | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (s.includes(':')) {
    const [mm, ss] = s.split(':').map((x) => x.trim());
    const m = Number(mm);
    const sec = Number(ss);
    if (!Number.isFinite(m) || !Number.isFinite(sec) || m < 0 || sec < 0) return null;
    return m * 60 + sec;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
