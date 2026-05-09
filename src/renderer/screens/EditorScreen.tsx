import { useEffect, useRef } from 'react';
import { useProjectStore, selectedTemplate } from '../store/projectStore';
import { api } from '../lib/api';
import { buildOverlays } from '../lib/overlays';
import LivePreview from '../components/LivePreview';
import LyricsEditor from '../components/LyricsEditor';
import AudioRangeSelector from '../components/AudioRangeSelector';
import TemplateGallery from '../components/TemplateGallery';

export default function EditorScreen(): JSX.Element {
  const state = useProjectStore();
  const template = selectedTemplate(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = state.startSec;
  }, [state.startSec]);

  const onPreviewPlay = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = state.startSec;
    audioRef.current.play();
    setTimeout(() => audioRef.current?.pause(), state.durationSec * 1000);
  };

  const onRender = async () => {
    if (!state.imagePath || !state.audioPath) return;
    state.setIsRendering(true);
    state.setScreen('export');

    let outputDir = state.outputDir;
    if (!outputDir) {
      outputDir = await api().defaultOutputDir();
      state.setOutputDir(outputDir);
    }

    const overlays = await buildOverlays({
      lyrics: state.parsedLyrics,
      template,
      highlightKorean: state.highlightKorean,
      durationSec: state.durationSec,
      trackTitle: state.trackTitle,
      artistName: state.artistName,
    });

    const result = await api().startRender({
      imagePath: state.imagePath,
      audioPath: state.audioPath,
      lyrics: state.parsedLyrics,
      template,
      startSec: state.startSec,
      durationSec: state.durationSec,
      trackTitle: state.trackTitle,
      artistName: state.artistName,
      highlightKorean: state.highlightKorean,
      outputPath: outputDir,
      overlays,
    });

    if (!result.ok) {
      // Error already broadcast via render:progress; nothing else to do here.
      // eslint-disable-next-line no-console
      console.error('Render failed:', result.error);
    }
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_460px] gap-5 p-5">
      {/* Left column: live preview */}
      <div className="flex min-h-0 flex-col items-center justify-center rounded-2xl border border-white/5 bg-ink-900 p-6">
        <div className="text-xs uppercase tracking-widest text-white/40">미리보기 (HTML)</div>
        <div className="mt-3 flex-1 min-h-0 flex items-center justify-center w-full">
          <LivePreview
            imageDataUrl={state.imageDataUrl}
            template={template}
            lyrics={state.parsedLyrics}
            highlightKorean={state.highlightKorean}
            trackTitle={state.trackTitle}
            artistName={state.artistName}
            durationSec={state.durationSec}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
          <span>실제 렌더 결과는 ffmpeg로 1080×1920 MP4로 출력됩니다.</span>
        </div>
      </div>

      {/* Right column: controls */}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <Section title="템플릿">
          <TemplateGallery />
        </Section>

        <Section title="오디오 구간">
          <AudioRangeSelector
            audioPath={state.audioPath}
            audioDurationSec={state.audioDurationSec}
            startSec={state.startSec}
            durationSec={state.durationSec}
            onChangeStart={state.setStartSec}
            onChangeDuration={state.setDurationSec}
            audioDataUrl={state.audioDataUrl}
            audioRef={audioRef}
            onPreviewPlay={onPreviewPlay}
          />
        </Section>

        <Section title="가사">
          <LyricsEditor
            lyricsRaw={state.lyricsRaw}
            onChangeRaw={state.setLyricsRaw}
            highlightKorean={state.highlightKorean}
            onChangeHighlightKorean={state.setHighlightKorean}
          />
        </Section>

        <Section title="메타">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              placeholder="곡 제목 (선택)"
              value={state.trackTitle}
              onChange={(e) => state.setTrackTitle(e.target.value)}
            />
            <input
              className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              placeholder="아티스트 (선택)"
              value={state.artistName}
              onChange={(e) => state.setArtistName(e.target.value)}
            />
          </div>
        </Section>

        <div className="sticky bottom-0 mt-2 flex justify-end gap-2 rounded-xl border border-white/10 bg-ink-900/90 p-3 backdrop-blur">
          <button
            onClick={() => state.setScreen('start')}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
          >
            ← 이전
          </button>
          <button
            onClick={onRender}
            disabled={!state.imagePath || !state.audioPath}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-soft disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
          >
            영상 출력 →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-white/5 bg-ink-900 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/50">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}
