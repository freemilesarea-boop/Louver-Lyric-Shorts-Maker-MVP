import { useProjectStore } from '../store/projectStore';
import { api } from '../lib/api';
import { useState } from 'react';

export default function StartScreen(): JSX.Element {
  const imagePath = useProjectStore((s) => s.imagePath);
  const imageDataUrl = useProjectStore((s) => s.imageDataUrl);
  const audioPath = useProjectStore((s) => s.audioPath);
  const audioDuration = useProjectStore((s) => s.audioDurationSec);
  const setImage = useProjectStore((s) => s.setImage);
  const setAudio = useProjectStore((s) => s.setAudio);
  const setScreen = useProjectStore((s) => s.setScreen);
  const [error, setError] = useState<string | null>(null);

  const onPickImage = async () => {
    setError(null);
    try {
      const path = await api().pickImage();
      if (!path) return;
      const dataUrl = await api().readAsDataURL(path);
      setImage(path, dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPickAudio = async () => {
    setError(null);
    try {
      const path = await api().pickAudio();
      if (!path) return;
      const meta = await api().probeAudio(path);
      const dataUrl = await api().readAsDataURL(path);
      setAudio(path, dataUrl, meta.durationSec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const canContinue = !!imagePath && !!audioPath;

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">새 프로젝트 시작</h1>
        <p className="mt-2 text-sm text-white/60">
          이미지 1장과 오디오 1개를 선택하면 9:16 세로 영상으로 만들 수 있어요.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-5">
          <UploadCard
            label="이미지 업로드"
            sub="JPG, PNG, WEBP"
            onClick={onPickImage}
            preview={
              imageDataUrl ? (
                <img src={imageDataUrl} alt="" className="h-full w-full object-cover" />
              ) : null
            }
            badge={imagePath ? '✓ 선택됨' : null}
          />
          <UploadCard
            label="오디오 업로드"
            sub="MP3, WAV, M4A"
            onClick={onPickAudio}
            preview={
              audioPath ? (
                <div className="flex h-full items-center justify-center bg-ink-800">
                  <div className="text-center">
                    <div className="text-xs text-white/50">DURATION</div>
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
}): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 text-left transition-all hover:border-white/30"
    >
      <div className="flex-1 overflow-hidden bg-ink-800">
        {props.preview ?? (
          <div className="flex h-full items-center justify-center text-white/30">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full border border-dashed border-white/30" />
              <div className="mt-3 text-xs">클릭해서 파일 선택</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{props.label}</div>
          <div className="text-xs text-white/40">{props.sub}</div>
        </div>
        {props.badge && (
          <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            {props.badge}
          </span>
        )}
      </div>
    </button>
  );
}

function formatDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
