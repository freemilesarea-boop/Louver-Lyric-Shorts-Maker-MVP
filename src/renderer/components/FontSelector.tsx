import { useEffect, useState } from 'react';
import { useProjectStore, effectiveLanguage } from '../store/projectStore';
import { api } from '../lib/api';
import {
  FONTS,
  FONT_KEYS,
  defaultFontForLanguage,
  fontFamilyFor,
  type FontKey,
} from '../../shared/fonts';

/**
 * Font picker. Writes to `userFontKey` in the store; null = follow the
 * per-language default. Selecting a font updates both the live preview
 * (canvas re-renders next frame) and the export overlay generator
 * (overlays.ts reads the same store value when baking PNGs).
 *
 * Renders a tiny live sample line so the user sees the bundled glyphs
 * before they commit to a render.
 */
export default function FontSelector(): JSX.Element {
  const userFontKey = useProjectStore((s) => s.userFontKey);
  const setUserFontKey = useProjectStore((s) => s.setUserFontKey);
  const language = useProjectStore(effectiveLanguage);
  const auto = defaultFontForLanguage(language);
  const effective: FontKey = userFontKey ?? auto;
  const def = FONTS[effective];

  // Track which families actually have bundled bytes so we can hint to
  // the user. Loader runs at app boot; we just ask the IPC again here
  // for the report.
  const [bundleStatus, setBundleStatus] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    api()
      .loadBundledFonts()
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, boolean> = {};
        for (const r of rows) {
          // A family counts as bundled if at least one variant loaded.
          // Empty `files` registry entries (e.g. SF Pro) report false here.
          next[r.key] = r.variants.some((v) => v.loaded);
        }
        setBundleStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
          {language} 자동 추천: <span className="font-semibold text-white">{FONTS[auto].label}</span>
        </span>
        <select
          value={userFontKey ?? '__auto__'}
          onChange={(e) => {
            const v = e.target.value;
            setUserFontKey(v === '__auto__' ? null : (v as FontKey));
          }}
          className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs focus:border-white/40 focus:outline-none"
          title="글씨체 직접 선택 — 미리보기 / 출력 모두 동일하게 적용"
        >
          <option value="__auto__">자동 ({FONTS[auto].label})</option>
          {FONT_KEYS.map((k) => {
            const label = FONTS[k].label;
            const bundled = bundleStatus[k];
            const tag = bundled === false ? ' (기본 글씨체로 표시)' : '';
            return (
              <option key={k} value={k}>
                {label}
                {tag}
              </option>
            );
          })}
        </select>
        {userFontKey && (
          <span className="rounded-full bg-accent/20 px-2 py-1 text-accent">
            직접 선택: {def.label}
          </span>
        )}
      </div>

      {/* Sample line in the chosen face — proves CSS pickup and gives the
          user a quick visual before render. */}
      <div
        className="rounded-md border border-white/10 bg-ink-800/40 px-3 py-2 leading-tight"
        style={{ fontFamily: fontFamilyFor(effective), fontSize: 18 }}
      >
        Sample · 가나다라마바사 · The quick brown fox.
      </div>

      {bundleStatus[effective] === false && def.files.length > 0 && (
        <div className="text-[11px] text-white/40">
          이 글씨체의 파일이 없어서 기본 글씨체로 표시 중입니다.
        </div>
      )}
    </div>
  );
}
