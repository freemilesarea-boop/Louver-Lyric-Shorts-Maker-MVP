import { useProjectStore, selectedTemplate } from '../store/projectStore';

/**
 * "스타일 직접 조절" panel — Phase 5-3 ships the four highest-impact
 * controls. Architecture supports more (border thickness, radius,
 * shadow toggle, position, alignment, panel opacity) — adding them is
 * a matter of extending StyleOverrides + this component.
 *
 * Each control reads from the store's `styleOverrides`, falls back to
 * the active template's value when unset, and can be reset to template
 * default via the small × button next to the control.
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
  };
  const hasAny =
    overrides.mainBorderColor !== undefined ||
    overrides.lyricPrimaryColor !== undefined ||
    overrides.lyricSecondaryColor !== undefined ||
    overrides.mainScale !== undefined;

  return (
    <div className="space-y-3 text-xs">
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
