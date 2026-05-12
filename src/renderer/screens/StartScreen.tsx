import { useProjectStore } from '../store/projectStore';
import { api } from '../lib/api';
import { useState } from 'react';
import HelpPanel from '../components/HelpPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import MediaValidationBanner from '../components/MediaValidationBanner';
import type { MediaKind } from '../../shared/types';

function detectMediaKind(path: string): MediaKind {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'gif') return 'gif';
  if (['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video';
  return 'image';
}

/**
 * Resolve the renderer-side preview src for a file.
 *
 * Phase 5-8.6 — gif/video go through `file://` directly (webSecurity
 * is now false in BrowserWindow). The previous media:// streaming
 * bridge produced net::ERR_UNEXPECTED in the user's Electron run
 * even after the Phase 5-8.5 net.fetch revert, which suggested the
 * custom-protocol layer itself was the unreliable component. file://
 * is Chromium's first-party loader; it works for arbitrary sizes
 * without any IPC bridge and supports Range natively.
 *
 * Image extensions still try readAsDataURL first (cheap canvas
 * painting, survives offline use, decode is synchronous). If a
 * supposedly-image file blows the 10MB DataURL cap, we fall back to
 * `file://` URLs instead of failing.
 */
async function resolveMediaSrc(path: string, kind: MediaKind): Promise<string> {
  if (kind !== 'image') {
    return api().toFileUrl(path);
  }
  try {
    return await api().readAsDataURL(path);
  } catch {
    return api().toFileUrl(path);
  }
}

export default function StartScreen(): JSX.Element {
  const imagePath = useProjectStore((s) => s.imagePath);
  const imageDataUrl = useProjectStore((s) => s.imageDataUrl);
  const mainMediaKind = useProjectStore((s) => s.mainMediaKind);
  const backgroundImagePath = useProjectStore((s) => s.backgroundImagePath);
  const backgroundImageDataUrl = useProjectStore((s) => s.backgroundImageDataUrl);
  const audioPath = useProjectStore((s) => s.audioPath);
  const audioDuration = useProjectStore((s) => s.audioDurationSec);
  const setImage = useProjectStore((s) => s.setImage);
  const setBackgroundImage = useProjectStore((s) => s.setBackgroundImage);
  const setAudio = useProjectStore((s) => s.setAudio);
  const setScreen = useProjectStore((s) => s.setScreen);
  const [error, setError] = useState<string | null>(null);

  const onPickImage = async () => {
    setError(null);
    try {
      const path = await api().pickImage();
      if (!path) return;
      const kind = detectMediaKind(path);
      const src = await resolveMediaSrc(path, kind);
      setImage(path, src, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPickBackground = async () => {
    setError(null);
    try {
      const path = await api().pickImage();
      if (!path) return;
      // Background should ideally be a still image, but the picker
      // accepts gif/video too — route them through media:// so a stray
      // pick doesn't crash the IPC.
      const kind = detectMediaKind(path);
      const src = await resolveMediaSrc(path, kind);
      setBackgroundImage(path, src);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onClearBackground = () => {
    setBackgroundImage(null, null);
  };

  const onPickAudio = async () => {
    setError(null);
    try {
      const path = await api().pickAudio();
      if (!path) return;
      const meta = await api().probeAudio(path);
      // Phase 5-8.6 — audio goes through file:// directly. media://
      // produced ERR_UNEXPECTED for both video and audio; bypassing
      // the custom protocol fixes both at once.
      const src = await api().toFileUrl(path);
      setAudio(path, src, meta.durationSec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const canContinue = !!imagePath && !!audioPath;

  return (
    <div className="flex h-full items-center justify-center px-8 py-6 overflow-y-auto">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">새 프로젝트 시작</h1>
        <p className="mt-2 text-sm text-white/60">
          메인 사진/영상/GIF와 오디오 1개를 선택하면 9:16 세로 영상이 만들어져요.
          배경 사진을 따로 고를 수도 있어요 (선택사항).
        </p>

        <div className="mt-5 space-y-3">
          <HelpPanel />
          <DiagnosticsPanel />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <UploadCard
            label="메인 사진/영상"
            sub="화면 중앙에 보이는 사진, GIF, 또는 영상"
            onClick={onPickImage}
            preview={
              imageDataUrl ? (
                mainMediaKind === 'video' ? (
                  <video
                    src={imageDataUrl}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img src={imageDataUrl} alt="" className="h-full w-full object-cover" />
                )
              ) : null
            }
            badge={imagePath ? '✓ 선택됨' : null}
          />
          <UploadCard
            label="배경 사진 (선택)"
            sub="흐리게 처리된 배경. 미선택시 메인 사진을 배경으로도 사용"
            onClick={onPickBackground}
            preview={
              backgroundImageDataUrl ? (
                <img src={backgroundImageDataUrl} alt="" className="h-full w-full object-cover" />
              ) : null
            }
            badge={backgroundImagePath ? '✓ 선택됨' : null}
            onClear={backgroundImagePath ? onClearBackground : undefined}
          />
          <UploadCard
            label="오디오 업로드"
            sub="MP3, WAV, M4A"
            onClick={onPickAudio}
            preview={
              audioPath ? (
                <div className="flex h-full items-center justify-center bg-ink-800">
                  <div className="text-center">
                    <div className="text-xs text-white/50">길이</div>
                    <div className="mt-1 font-mono text-2xl">
                      {formatDur(audioDuration)}
                    </div>
                  </div>
                </div>
              ) : null
            }
            badge={audioPath ? '✓ 선택됨' : null}
          />
        </div>

        {/* Phase 5-8.1 — codec validation banner. Hidden when the file
         *  is an image / gif / supported video; shown with detected
         *  codec + transcode button otherwise. */}
        <MediaValidationBanner
          path={imagePath}
          kind={mainMediaKind}
          onTranscoded={async (newPath) => {
            const src = await api().toFileUrl(newPath);
            setImage(newPath, src, 'video');
          }}
        />

        {error && (
          <div className="mt-6 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-3">
          <button
            onClick={() => setScreen('editor')}
            disabled={!canContinue}
            className={[
              'rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors',
              canContinue
                ? 'bg-accent text-ink-950 hover:bg-accent-soft'
                : 'bg-white/10 text-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            편집하러 가기 →
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadCard(props: {
  label: string;
  sub: string;
  onClick: () => void;
  preview: React.ReactNode | null;
  badge: string | null;
  /** When set, shows a small "× 제거" affordance at the bottom-right.
   *  Only used by the optional background card so the user can revert. */
  onClear?: () => void;
}): JSX.Element {
  return (
    <div className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 text-left transition-all hover:border-white/30">
      <button
        onClick={props.onClick}
        type="button"
        className="flex-1 overflow-hidden bg-ink-800 text-left"
      >
        {props.preview ?? (
          <div className="flex h-full items-center justify-center text-white/30">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full border border-dashed border-white/30" />
              <div className="mt-3 text-xs">클릭해서 파일 선택</div>
            </div>
          </div>
        )}
      </button>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{props.label}</div>
          <div className="truncate text-[11px] text-white/40">{props.sub}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.badge && (
            <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              {props.badge}
            </span>
          )}
          {props.onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onClear?.();
              }}
              className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/15 hover:text-white/80"
              title="배경 사진 제거"
            >
              × 제거
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
