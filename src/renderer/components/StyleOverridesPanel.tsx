import { useProjectStore, selectedTemplate } from '../store/projectStore';
import {
  LYRIC_EFFECTS,
  LYRIC_EFFECT_LABEL,
  type LyricEffect,
} from '../../shared/types';
import { resolveDisplay } from '../../shared/scene';
import { FONTS, FONT_KEYS, type FontKey } from '../../shared/fonts';

/**
 * "스타일 직접 조절" panel — Phase 5-3 shipped border color, lyric
 * primary/secondary color, and main scale. Phase 5-4 adds: lyric visual
 * effect, lyric font scale, and a parallel set of meta (track title /
 * artist) overrides (font, color, scale).
 *
 * Each control reads from the store's `styleOverrides`, falls back to
 * the active template's value when unset, and can be reset to the
 * template default via the small × button next to the control.
 */
export default function StyleOverridesPanel(): JSX.Element {
  const overrides = useProjectStore((s) => s.styleOverrides);
  const setOverrides = useProjectStore((s) => s.setStyleOverrides);
  const resetAll = useProjectStore((s) => s.resetStyleOverrides);
  const template = useProjectStore(selectedTemplate);

  const effective = {
    mainBorderColor: overrides.mainBorderColor ?? template.frameColor ?? '#FFFFFF',
    lyricPrimaryColor: overrides.lyricPrimaryColor ?? template.lyricColor,
    lyricSecondaryColor: overrides.lyricSecondaryColor ?? template.lyricSubColor,
    mainScale: overrides.mainScale ?? 1,
    lyricEffect: (overrides.lyricEffect ?? 'soft_shadow') as LyricEffect,
    lyricFontScale: overrides.lyricFontScale ?? 1,
    metaColor: overrides.metaColor ?? template.lyricColor,
    metaFontScale: overrides.metaFontScale ?? 1,
    metaFontKey: (overrides.metaFontKey ?? '__auto__') as string,
  };
  // Phase 5-7 — effective display state (template default vs override).
  // The toggle UI below shows the *effective* on/off state and writes the
  // override only when the user changes it; resetting clears the field
  // so it falls back to the template's default again.
  const display = resolveDisplay(template, overrides);
  const hasAny =
    overrides.mainBorderColor !== undefined ||
    overrides.lyricPrimaryColor !== undefined ||
    overrides.lyricSecondaryColor !== undefined ||
    overrides.mainScale !== undefined ||
    overrides.lyricEffect !== undefined ||
    overrides.lyricFontScale !== undefined ||
    overrides.metaColor !== undefined ||
    overrides.metaFontScale !== undefined ||
    overrides.metaFontKey !== undefined ||
    overrides.showWaveform !== undefined ||
    overrides.showPlayerChrome !== undefined;

  return (
    <div className="space-y-4 text-xs">
      <Group title="사진 / 가사 색상">
        <Row
          label="사진 테두리 색"
          active={overrides.mainBorderColor !== undefined}
          onReset={() => setOverrides({ mainBorderColor: undefined })}
        >
          <input
            type="color"
            value={effective.mainBorderColor}
            onChange={(e) => setOverrides({ mainBorderColor: e.target.value })}
            className="h-8 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <span className="font-mono text-[11px] text-white/50">{effective.mainBorderColor}</span>
        </Row>

        <Row
          label="영문/주 가사 색"
          active={overrides.lyricPrimaryColor !== undefined}
          onReset={() => setOverrides({ lyricPrimaryColor: undefined })}
        >
          <input
            type="color"
            value={effective.lyricPrimaryColor}
            onChange={(e) => setOverrides({ lyricPrimaryColor: e.target.value })}
            className="h-8 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <span className="font-mono text-[11px] text-white/50">{effective.lyricPrimaryColor}</span>
        </Row>

        <Row
          label="한글/보조 가사 색"
          active={overrides.lyricSecondaryColor !== undefined}
          onReset={() => setOverrides({ lyricSecondaryColor: undefined })}
        >
          <input
            type="color"
            value={effective.lyricSecondaryColor}
            onChange={(e) => setOverrides({ lyricSecondaryColor: e.target.value })}
            className="h-8 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <span className="font-mono text-[11px] text-white/50">{effective.lyricSecondaryColor}</span>
        </Row>

        <Row
          label="사진 크기"
          active={overrides.mainScale !== undefined}
          onReset={() => setOverrides({ mainScale: undefined })}
        >
          <input
            type="range"
            min={0.6}
            max={1.2}
            step={0.05}
            value={effective.mainScale}
            onChange={(e) => setOverrides({ mainScale: parseFloat(e.target.value) })}
            className="h-2 w-32 cursor-pointer accent-accent"
          />
          <span className="font-mono text-[11px] text-white/50">
            {(effective.mainScale * 100).toFixed(0)}%
          </span>
        </Row>
      </Group>

      <Group title="가사 효과 / 크기">
        <Row
          label="가사 효과"
          active={overrides.lyricEffect !== undefined}
          onReset={() => setOverrides({ lyricEffect: undefined })}
        >
          <select
            value={effective.lyricEffect}
            onChange={(e) =>
              setOverrides({ lyricEffect: e.target.value as LyricEffect })
            }
            className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          >
            {LYRIC_EFFECTS.map((eff) => (
              <option key={eff} value={eff}>
                {LYRIC_EFFECT_LABEL[eff]}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="가사 글씨 크기"
          active={overrides.lyricFontScale !== undefined}
          onReset={() => setOverrides({ lyricFontScale: undefined })}
        >
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={effective.lyricFontScale}
            onChange={(e) =>
              setOverrides({ lyricFontScale: parseFloat(e.target.value) })
            }
            className="h-2 w-32 cursor-pointer accent-accent"
          />
          <span className="font-mono text-[11px] text-white/50">
            {(effective.lyricFontScale * 100).toFixed(0)}%
          </span>
        </Row>
      </Group>

      <Group title="곡 정보 (제목 / 아티스트)">
        <Row
          label="곡 정보 글씨체"
          active={overrides.metaFontKey !== undefined}
          onReset={() => setOverrides({ metaFontKey: undefined })}
        >
          <select
            value={effective.metaFontKey}
            onChange={(e) =>
              setOverrides({
                metaFontKey:
                  e.target.value === '__auto__'
                    ? undefined
                    : (e.target.value as FontKey),
              })
            }
            className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          >
            <option value="__auto__">가사와 동일</option>
            {FONT_KEYS.map((k) => (
              <option key={k} value={k}>
                {FONTS[k].label}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="곡 정보 색"
          active={overrides.metaColor !== undefined}
          onReset={() => setOverrides({ metaColor: undefined })}
        >
          <input
            type="color"
            value={effective.metaColor}
            onChange={(e) => setOverrides({ metaColor: e.target.value })}
            className="h-8 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <span className="font-mono text-[11px] text-white/50">{effective.metaColor}</span>
        </Row>

        <Row
          label="곡 정보 크기"
          active={overrides.metaFontScale !== undefined}
          onReset={() => setOverrides({ metaFontScale: undefined })}
        >
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={effective.metaFontScale}
            onChange={(e) =>
              setOverrides({ metaFontScale: parseFloat(e.target.value) })
            }
            className="h-2 w-32 cursor-pointer accent-accent"
          />
          <span className="font-mono text-[11px] text-white/50">
            {(effective.metaFontScale * 100).toFixed(0)}%
          </span>
        </Row>
      </Group>

      <Group title="표시 요소">
        <Row
          label="재생 플레이어"
          active={overrides.showPlayerChrome !== undefined}
          onReset={() => setOverrides({ showPlayerChrome: undefined })}
        >
          <ToggleSegment
            value={display.showPlayerChrome || display.showProgressBar}
            onChange={(v) => setOverrides({ showPlayerChrome: v })}
          />
          <span className="text-[11px] text-white/40">
            진행바 + 음악 앱 스타일 카드
          </span>
        </Row>
        <Row
          label="웨이브폼"
          active={overrides.showWaveform !== undefined}
          onReset={() => setOverrides({ showWaveform: undefined })}
        >
          <ToggleSegment
            value={display.showWaveform}
            onChange={(v) => setOverrides({ showWaveform: v })}
          />
          <span className="text-[11px] text-white/40">
            오디오에 반응하는 이퀄라이저 막대
          </span>
        </Row>
      </Group>

      {hasAny && (
        <button
          onClick={resetAll}
          className="rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white"
        >
          템플릿 기본값으로 모두 되돌리기
        </button>
      )}
    </div>
  );
}

function Group(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-white/5 bg-ink-900/30 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
        {props.title}
      </div>
      <div className="space-y-2">{props.children}</div>
    </div>
  );
}

/**
 * Two-button on/off segmented control. Used for "표시 요소" toggles —
 * the user always sees both states and a tap commits immediately.
 */
function ToggleSegment(props: {
  value: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  const seg = (label: string, on: boolean, target: boolean) => (
    <button
      onClick={() => props.onChange(target)}
      className={[
        'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
        on ? 'bg-accent text-ink-950' : 'bg-white/10 text-white/60 hover:bg-white/15',
      ].join(' ')}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1">
      {seg('표시', props.value === true, true)}
      {seg('숨김', props.value === false, false)}
    </div>
  );
}

function Row(props: {
  label: string;
  active: boolean;
  onReset: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-32 shrink-0 items-center gap-1.5">
        <span className="text-white/70">{props.label}</span>
        {props.active && (
          <button
            onClick={props.onReset}
            className="rounded bg-white/5 px-1 text-[10px] text-white/40 hover:bg-white/15 hover:text-white/70"
            title="템플릿 기본값으로 되돌리기"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2">{props.children}</div>
    </div>
  );
}
