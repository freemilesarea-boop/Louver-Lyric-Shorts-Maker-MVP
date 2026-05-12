import { useEffect } from 'react';
import { useProjectStore } from './store/projectStore';
import { api } from './lib/api';
import { loadBundledFontsIntoDocument } from './lib/fontLoader';
import StartScreen from './screens/StartScreen';
import EditorScreen from './screens/EditorScreen';
import ExportScreen from './screens/ExportScreen';

export default function App(): JSX.Element {
  const screen = useProjectStore((s) => s.screen);
  const setRenderProgress = useProjectStore((s) => s.setRenderProgress);
  const setLastOutputPath = useProjectStore((s) => s.setLastOutputPath);
  const setIsRendering = useProjectStore((s) => s.setIsRendering);

  // Boot-time bundled font registration. The promise resolves before
  // the user can touch the editor in practice; if any FontFace fails
  // we keep going on system fallbacks (logged to console).
  useEffect(() => {
    loadBundledFontsIntoDocument().catch(() => undefined);
  }, []);

  useEffect(() => {
    const off = api().onRenderProgress((p) => {
      setRenderProgress(p);
      // Mirror per-render progress into the active batch item (if any) so
      // the batch view can show a live progress bar next to the row that's
      // currently rendering. We read the active idx from the live store
      // rather than relying on an effect dep to avoid stale closures.
      const s = useProjectStore.getState();
      if (s.batchItems.length > 0 && s.batchActiveIdx >= 0) {
        if (p.stage === 'rendering') {
          s.updateBatchItem(s.batchActiveIdx, { progressPercent: p.percent });
        }
      } else {
        // Single-render flow only — track the global completion.
        if (p.stage === 'done') {
          setIsRendering(false);
          if (p.outputPath) setLastOutputPath(p.outputPath);
        } else if (p.stage === 'error' || p.stage === 'cancelled') {
          setIsRendering(false);
        }
      }
    });
    return off;
  }, [setRenderProgress, setLastOutputPath, setIsRendering]);

  return (
    <div className="relative flex h-screen flex-col bg-ink-950 text-white">
      <Topbar />
      <main className="flex-1 overflow-hidden">
        {screen === 'start' && <StartScreen />}
        {screen === 'editor' && <EditorScreen />}
        {screen === 'export' && <ExportScreen />}
      </main>
      <LouverAppBrand />
    </div>
  );
}

/**
 * Always-visible app brand at the bottom-left of the window. Distinct from
 * the per-render export watermark — that one ships in the MP4 and is user-
 * toggleable. This one is the desktop app's own brand mark, like a chrome.
 */
function LouverAppBrand(): JSX.Element {
  return (
    <div
      className="pointer-events-none fixed bottom-2 left-3 z-20 select-none text-[10px] leading-tight text-white/40"
      aria-label="Louver Lyric Shorts Maker"
    >
      <div className="font-semibold tracking-wide text-white/55">Louver</div>
      <div>Lyric Shorts Maker · v0.1.0</div>
    </div>
  );
}

function Topbar(): JSX.Element {
  const screen = useProjectStore((s) => s.screen);
  const setScreen = useProjectStore((s) => s.setScreen);
  const stage = (label: string, key: 'start' | 'editor' | 'export', enabled: boolean) => (
    <button
      key={key}
      disabled={!enabled}
      onClick={() => enabled && setScreen(key)}
      className={[
        'rounded-full px-3 py-1 text-xs no-select transition-colors',
        screen === key
          ? 'bg-white text-ink-950'
          : enabled
            ? 'bg-white/10 hover:bg-white/20'
            : 'bg-white/5 text-white/30 cursor-not-allowed',
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <header className="flex items-center justify-between border-b border-white/5 px-5 py-3 no-select">
      <div className="flex items-center gap-3">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-accent-soft" />
        <div>
          <div className="text-sm font-semibold tracking-tight">Lyric Shorts Maker</div>
          <div className="text-[11px] text-white/40">9:16 세로 영상 · 1080×1920</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {stage('1. 시작', 'start', true)}
        {stage('2. 편집', 'editor', true)}
        {stage('3. 출력', 'export', true)}
      </div>
    </header>
  );
}
