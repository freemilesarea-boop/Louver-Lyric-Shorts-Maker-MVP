import { useEffect, useRef, useState } from 'react';
import {
  useProjectStore,
  selectedTemplate,
  effectiveLanguage,
  effectiveMotion,
  effectiveAnimation,
  effectiveReactive,
} from '../store/projectStore';
import { api } from '../lib/api';
import { buildOverlays } from '../lib/overlays';
import LivePreview from '../components/LivePreview';
import LyricsEditor from '../components/LyricsEditor';
import LyricTimeline from '../components/LyricTimeline';
import LanguageSelector from '../components/LanguageSelector';
import MotionSelector from '../components/MotionSelector';
import AnimationSelector from '../components/AnimationSelector';
import ReactiveSelector from '../components/ReactiveSelector';
import AudioRangeSelector from '../components/AudioRangeSelector';
import TemplateGallery from '../components/TemplateGallery';

export default function EditorScreen(): JSX.Element {
  const state = useProjectStore();
  const template = selectedTemplate(state);
  const language = effectiveLanguage(state);
  const motion = effectiveMotion(state);
  const animation = effectiveAnimation(state);
  const reactive = effectiveReactive(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = state.startSec;
  }, [state.startSec]);

  // Analyze amplitude when the audio path or selected range changes. The
  // result is stored once and reused by both preview and export.
  useEffect(() => {
    let cancelled = false;
    if (!state.audioPath) {
      state.setAmplitudeCurve(null);
      return;
    }
    api()
      .analyzeAmplitude(state.audioPath, state.startSec, state.durationSec)
      .then((curve) => {
        if (!cancelled) state.setAmplitudeCurve(curve);
      })
      .catch((err) => {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('[reactive] amplitude analysis failed:', err);
          state.setAmplitudeCurve(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.audioPath, state.startSec, state.durationSec]);

  const onPreviewPlay = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = state.startSec;
    audioRef.current.play();
    setTimeout(() => audioRef.current?.pause(), state.durationSec * 1000);
  };

  const onRender = async () => {
    setValidationError(null);
    if (!state.imagePath) {
      setValidationError('이미지가 선택되지 않았습니다. Start 화면에서 다시 선택해주세요.');
      return;
    }
    if (!state.audioPath) {
      setValidationError('오디오가 선택되지 않았습니다. Start 화면에서 다시 선택해주세요.');
      return;
    }
    if (state.parsedLyrics.length === 0) {
      const ok = window.confirm(
        '가사가 비어 있습니다. 자막 없이 그대로 출력할까요?',
      );
      if (!ok) return;
    }
    // Time-range overflow check (any line.end exceeds duration).
    const overflow = state.parsedLyrics.find(
      (l) => typeof l.end === 'number' && l.end > state.durationSec,
    );
    if (overflow) {
      const ok = window.confirm(
        `일부 가사 줄의 종료 시간(${overflow.end?.toFixed(1)}s)이 클립 길이(${state.durationSec}s)를 넘습니다. 잘려서 표시됩니다. 계속할까요?`,
      );
      if (!ok) return;
    }

    let outputDir = state.outputDir;
    if (!outputDir) {
      try {
        outputDir = await api().defaultOutputDir();
      } catch (e) {
        setValidationError(
          `기본 출력 폴더를 만들 수 없습니다: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return;
      }
      state.setOutputDir(outputDir);
    }

    state.setLastError(null);
    state.setIsRendering(true);
    state.setScreen('export');

    try {
      const overlays = await buildOverlays({
        lyrics: state.parsedLyrics,
        template,
        language,
        animationPreset: animation,
        reactiveMode: reactive,
        amplitudeCurve: state.amplitudeCurve,
        highlightSub: state.highlightKorean,
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
        motionPreset: motion,
        animationPreset: animation,
        reactiveMode: reactive,
        amplitudeCurve: state.amplitudeCurve,
      });

      if (!result.ok) {
        state.setIsRendering(false);
        state.setLastError(result.error ?? 'Unknown render error');
      }
    } catch (e) {
      state.setIsRendering(false);
      state.setLastError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_500px] gap-5 p-5">
      {/* Left column: live preview */}
      <div className="flex min-h-0 flex-col items-center justify-center rounded-2xl border border-white/5 bg-ink-900 p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-white/40">
          미리보기 · 1080×1920 (canvas)
        </div>
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <LivePreview
            imageDataUrl={state.imageDataUrl}
            template={template}
            language={language}
            lyrics={state.parsedLyrics}
            highlightSub={state.highlightKorean}
            trackTitle={state.trackTitle}
            artistName={state.artistName}
            durationSec={state.durationSec}
            motionPreset={motion}
            animationPreset={animation}
            reactiveMode={reactive}
            amplitudeCurve={state.amplitudeCurve}
          />
        </div>
        <div className="mt-2 text-[10px] text-white/40">
          이 미리보기는 export 와 동일한 scene renderer를 사용합니다.
        </div>
      </div>

      {/* Right column: controls */}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <Section title="템플릿">
          <TemplateGallery />
        </Section>

        <Section title="언어">
          <LanguageSelector />
        </Section>

        <Section title="포토 모션">
          <MotionSelector />
        </Section>

        <Section title="가사 애니메이션">
          <AnimationSelector />
        </Section>

        <Section title="오디오 리액티브">
          <ReactiveSelector />
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

        <Section title="줄별 타임라인">
          <LyricTimeline audioRef={audioRef} />
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

        {validationError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {validationError}
          </div>
        )}

        <div className="sticky bottom-0 mt-2 flex justify-end gap-2 rounded-xl border border-white/10 bg-ink-900/90 p-3 backdrop-blur">
          <button
            onClick={() => state.setScreen('start')}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
          >
            ← 이전
          </button>
          <button
            onClick={onRender}
            disabled={!state.imagePath || !state.audioPath || state.isRendering}
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
