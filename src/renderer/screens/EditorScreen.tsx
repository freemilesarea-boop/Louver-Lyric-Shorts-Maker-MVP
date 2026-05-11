import { useEffect, useRef, useState } from 'react';
import {
  useProjectStore,
  selectedTemplate,
  effectiveLanguage,
  effectiveMotion,
  effectiveAnimation,
  effectiveReactive,
  effectiveFx,
  effectiveWatermark,
} from '../store/projectStore';
import { api } from '../lib/api';
import { buildOverlays } from '../lib/overlays';
import LivePreview from '../components/LivePreview';
import MediaValidationBanner from '../components/MediaValidationBanner';
import LyricsEditor from '../components/LyricsEditor';
import LyricTimeline from '../components/LyricTimeline';
import LanguageSelector from '../components/LanguageSelector';
import MotionSelector from '../components/MotionSelector';
import AnimationSelector from '../components/AnimationSelector';
import ReactiveSelector from '../components/ReactiveSelector';
import CinematicFxSelector from '../components/CinematicFxSelector';
import AudioRangeSelector from '../components/AudioRangeSelector';
import TemplateGallery from '../components/TemplateGallery';
import SamplePresetPicker from '../components/SamplePresetPicker';
import TranscribeButton from '../components/TranscribeButton';
import BatchPicker from '../components/BatchPicker';
import CustomPresetPanel from '../components/CustomPresetPanel';
import SafeZoneToggle from '../components/SafeZoneToggle';
import HookSuggester from '../components/HookSuggester';
import FontSelector from '../components/FontSelector';
import { prettyErrorMessage } from '../../shared/errors';
import { getExportPreset } from '../../shared/exportPresets';
import ExportPresetSelector from '../components/ExportPresetSelector';
import WatermarkSelector from '../components/WatermarkSelector';
import StyleOverridesPanel from '../components/StyleOverridesPanel';

export default function EditorScreen(): JSX.Element {
  const state = useProjectStore();
  const template = selectedTemplate(state);
  const language = effectiveLanguage(state);
  const motion = effectiveMotion(state);
  const animation = effectiveAnimation(state);
  const reactive = effectiveReactive(state);
  const fxPreset = effectiveFx(state);
  const watermark = effectiveWatermark(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  /** Phase 5-8.1 — set when LivePreview's <video> errors or its 5s
   *  canplay watchdog trips. Forces the MediaValidationBanner to show
   *  even if the file was an extension we'd have skipped probing. */
  const [videoUnsupported, setVideoUnsupported] = useState(false);
  // Clear the unsupported flag the moment the user picks a new file
  // — the new path may well be fine.
  useEffect(() => {
    setVideoUnsupported(false);
  }, [state.imagePath]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = state.startSec;
  }, [state.startSec]);

  // Stop the preview if the user changes the selected window mid-play —
  // otherwise the audio would keep going past the (now-stale) endSec.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !isPreviewPlaying) return;
    a.pause();
    setIsPreviewPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.startSec, state.durationSec, state.audioPath]);

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

  // Toggle playback of the selected [startSec, startSec+durationSec]
  // window. Stops automatically at the end via a `timeupdate` listener
  // (more accurate than a setTimeout, which drifts when the browser
  // throttles the tab). Re-clicking while playing pauses immediately.
  const onPreviewPlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPreviewPlaying) {
      a.pause();
      setIsPreviewPlaying(false);
      return;
    }
    const endSec = state.startSec + state.durationSec;
    a.currentTime = state.startSec;
    const onTime = () => {
      if (a.currentTime >= endSec) {
        a.pause();
        a.removeEventListener('timeupdate', onTime);
        a.removeEventListener('pause', onPause);
        setIsPreviewPlaying(false);
      }
    };
    const onPause = () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('pause', onPause);
      setIsPreviewPlaying(false);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('pause', onPause);
    a.play()
      .then(() => setIsPreviewPlaying(true))
      .catch(() => {
        a.removeEventListener('timeupdate', onTime);
        a.removeEventListener('pause', onPause);
      });
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
    state.resetBatch();
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
        fxPreset,
        highlightSub: state.highlightKorean,
        durationSec: state.durationSec,
        trackTitle: state.trackTitle,
        artistName: state.artistName,
        karaokeEnabled: state.karaokeEnabled,
        lyricPositionOverride: state.manualLyricPosition,
        fontKey: state.userFontKey,
        watermark,
        styleOverrides: state.styleOverrides,
        layoutOverrides: state.layoutOverrides,
      });

      const presetDef = getExportPreset(state.exportPresetKey);
      const result = await api().startRender({
        imagePath: state.imagePath,
        mainMediaKind: state.mainMediaKind,
        backgroundImagePath: state.backgroundImagePath,
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
        fxPreset,
        nameTag: presetDef.filenameSuffix,
        exportEncode: presetDef.encode,
        styleOverrides: state.styleOverrides,
        layoutOverrides: state.layoutOverrides,
      });

      if (!result.ok) {
        state.setIsRendering(false);
        state.setLastError(prettyErrorMessage(result.error ?? 'Unknown render error'));
      } else if (result.timings) {
        state.setLastRenderTimings(result.timings);
      }
    } catch (e) {
      state.setIsRendering(false);
      state.setLastError(prettyErrorMessage(e));
    }
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_500px] gap-5 p-5">
      {/* Left column: live preview */}
      <div className="flex min-h-0 flex-col items-center justify-center rounded-2xl border border-white/5 bg-ink-900 p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-white/40">
          미리보기 · 1080×1920
        </div>
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <LivePreview
            imageDataUrl={state.imageDataUrl}
            mainMediaKind={state.mainMediaKind}
            backgroundImageDataUrl={state.backgroundImageDataUrl}
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
            fxPreset={fxPreset}
            karaokeEnabled={state.karaokeEnabled}
            safeZone={{ enabled: state.safeZoneEnabled, platform: state.safeZonePlatform }}
            lyricPositionOverride={state.manualLyricPosition}
            fontKey={state.userFontKey}
            watermark={watermark}
            styleOverrides={state.styleOverrides}
            layoutOverrides={state.layoutOverrides}
            layoutEditMode={state.layoutEditMode}
            onLayoutChange={state.setLayoutOverride}
            onVideoUnsupported={() => setVideoUnsupported(true)}
          />
          {/* Phase 5-8.1 — codec banner. Hidden until the inner <video>
            *  errors or the watchdog flags an unsupported source. On
            *  transcode success we swap the store's main media so the
            *  preview re-resolves with the new file. */}
          <div className="w-full max-w-md">
            <MediaValidationBanner
              path={state.imagePath}
              kind={state.mainMediaKind}
              forceShow={videoUnsupported}
              onTranscoded={async (newPath) => {
                const src = await api().toMediaUrl(newPath);
                state.setImage(newPath, src, 'video');
                setVideoUnsupported(false);
              }}
            />
          </div>
        </div>
        <div className="mt-2 w-full">
          <SafeZoneToggle />
        </div>
        <div className="mt-2 flex w-full items-center justify-between gap-2 text-[11px]">
          <label className="flex cursor-pointer items-center gap-2 text-white/70">
            <input
              type="checkbox"
              checked={state.layoutEditMode}
              onChange={(e) => state.setLayoutEditMode(e.target.checked)}
            />
            위치 편집 모드 (가사 / 곡 정보 / 웨이브폼 드래그)
          </label>
          {Object.keys(state.layoutOverrides).length > 0 && (
            <button
              onClick={state.resetLayoutOverrides}
              className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/60 hover:bg-white/15 hover:text-white"
            >
              위치 초기화
            </button>
          )}
        </div>
        <div className="mt-2 text-[10px] text-white/40">
          미리보기와 출력 영상은 동일한 화면을 사용합니다.
          {state.layoutEditMode &&
            ' 핸들을 끌어 위치를 옮길 수 있어요. 더블클릭하면 기본값으로 돌아갑니다.'}
        </div>
      </div>

      {/* Right column: controls */}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <Section title="추천 스타일">
          <SamplePresetPicker />
        </Section>

        <Section title="스타일 설정">
          <div className="space-y-4">
            <SubControl label="디자인 템플릿">
              <TemplateGallery />
            </SubControl>
            <SubControl label="사진 움직임">
              <MotionSelector />
            </SubControl>
            <SubControl label="가사 애니메이션">
              <div className="space-y-2">
                <AnimationSelector />
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/70">
                  <input
                    type="checkbox"
                    checked={state.karaokeEnabled}
                    onChange={(e) => state.setKaraokeEnabled(e.target.checked)}
                  />
                  단어별 하이라이트 (노래방 효과, 기본 꺼짐)
                </label>
              </div>
            </SubControl>
            <SubControl label="음악 반응 효과">
              <ReactiveSelector />
            </SubControl>
            <SubControl label="감성 필터">
              <CinematicFxSelector />
            </SubControl>
            <SubControl label="글씨체">
              <FontSelector />
            </SubControl>
          </div>
        </Section>

        <Section title="스타일 직접 조절">
          <StyleOverridesPanel />
        </Section>

        <Section title="언어">
          <LanguageSelector />
        </Section>

        <Section title="오디오 구간">
          <div className="space-y-3">
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
              isPreviewPlaying={isPreviewPlaying}
            />
            <HookSuggester />
          </div>
        </Section>

        <Section title="가사">
          <div className="space-y-3">
            <TranscribeButton />
            <LyricsEditor
              lyricsRaw={state.lyricsRaw}
              onChangeRaw={state.setLyricsRaw}
              highlightKorean={state.highlightKorean}
              onChangeHighlightKorean={state.setHighlightKorean}
            />
          </div>
        </Section>

        <Section title="줄별 타이밍">
          <LyricTimeline audioRef={audioRef} />
        </Section>

        <Section title="내 스타일 저장">
          <CustomPresetPanel />
        </Section>

        <Section title="여러 스타일 한 번에 만들기">
          <div className="space-y-1">
            <div className="text-[11px] text-white/50">
              한 번 클릭으로 여러 스타일을 자동 생성합니다. 단일 영상은 아래 "영상 만들기" 버튼.
            </div>
            <BatchPicker />
          </div>
        </Section>

        <Section title="출력 용도">
          <ExportPresetSelector />
        </Section>

        <Section title="브랜드 표시">
          <WatermarkSelector />
        </Section>

        <Section title="곡 정보">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              placeholder="곡 제목 (선택사항)"
              value={state.trackTitle}
              onChange={(e) => state.setTrackTitle(e.target.value)}
            />
            <input
              className="rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              placeholder="아티스트 (선택사항)"
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
            영상 만들기 →
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

function SubControl(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {props.label}
      </div>
      {props.children}
    </div>
  );
}
