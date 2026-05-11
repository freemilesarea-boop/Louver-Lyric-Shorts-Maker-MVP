import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MediaProbeReply } from '../../shared/api';
import type { MediaKind } from '../../shared/types';

interface Props {
  /** Absolute path to the picked main media file. Null = no file yet. */
  path: string | null;
  /** Picked kind from the file picker (extension-derived). 'image'/'gif'
   *  short-circuit the probe — Chromium accepts JPG/PNG/WebP/GIF
   *  natively, no codec gotchas there. */
  kind: MediaKind;
  /** Forced visibility (true when the LivePreview <video> element fires
   *  a real `error` event for code 4 or the 5s watchdog trips). Lets
   *  the same banner serve both the upload-time probe path and the
   *  runtime-failure path. */
  forceShow?: boolean;
  /** Called after a successful transcode. Parent should setImage() with
   *  the new path so the store + preview re-resolve. */
  onTranscoded: (newPath: string) => void;
}

/**
 * Phase 5-8.1 — codec/pixel-format validator. Probes the picked media
 * with ffprobe and:
 *   - hides itself if the format is supported (preview will work).
 *   - surfaces a yellow banner with detected codec/resolution/pixel
 *     format AND a "권장 형식으로 변환하기" button if not.
 *
 * The transcode IPC writes a libx264/yuv420p MP4 to the OS temp dir;
 * on success we swap the store's imagePath to the new file and the
 * preview re-resolves. Progress streams through onTranscodeProgress.
 */
export default function MediaValidationBanner(props: Props): JSX.Element | null {
  const [reply, setReply] = useState<MediaProbeReply | null>(null);
  const [probing, setProbing] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [transcodePct, setTranscodePct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReply(null);
    setError(null);
    if (!props.path) return;
    if (props.kind !== 'video') return; // image/gif don't need ffprobe
    let cancelled = false;
    setProbing(true);
    api()
      .probeMedia(props.path)
      .then((r) => {
        if (!cancelled) setReply(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : '영상 정보를 확인할 수 없습니다.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.path, props.kind]);

  // Subscribe to transcode progress while a transcode is in flight.
  useEffect(() => {
    if (!transcoding) return;
    const unsub = api().onTranscodeProgress((p) => {
      setTranscodePct(Math.max(0, Math.min(100, p.percent)));
    });
    return () => {
      unsub();
    };
  }, [transcoding]);

  const onConvert = async () => {
    if (!props.path) return;
    setTranscoding(true);
    setTranscodePct(0);
    setError(null);
    try {
      const result = await api().transcodeMainMedia(props.path);
      if (!result.ok) {
        setError(`변환 실패: ${result.error}`);
        return;
      }
      props.onTranscoded(result.outputPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscoding(false);
    }
  };

  // Banner is invisible when: no file, image/gif kind, probe passed,
  // and the parent hasn't forced visibility (no runtime error).
  if (!props.path) return null;
  if (props.kind !== 'video' && !props.forceShow) return null;
  if (reply?.supported && !props.forceShow) return null;
  if (!reply && !props.forceShow && !probing && !error) return null;

  const info = reply?.probe;
  const detected = info
    ? [
        info.videoCodec ?? 'unknown codec',
        info.width && info.height ? `${info.width}×${info.height}` : null,
        info.pixelFormat ?? null,
        info.durationSec > 0 ? `${info.durationSec.toFixed(1)}s` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-[12px] leading-relaxed text-yellow-100">
      {probing && (
        <div className="flex items-center gap-2 text-yellow-200/80">
          <span>영상 정보를 확인하는 중...</span>
        </div>
      )}
      {!probing && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">
              {reply?.supported
                ? '미리보기에 사용할 수 있는 영상이에요.'
                : '미리보기에서 지원하지 않는 형식이에요.'}
            </div>
          </div>
          {detected && (
            <div className="mt-1 text-[11px] text-yellow-200/80">
              감지된 형식: <span className="font-mono">{detected}</span>
            </div>
          )}
          {!reply?.supported && (
            <div className="mt-1 text-[11px] text-yellow-200/80">
              {reply?.reason ||
                '권장 형식: MP4 / H.264 / yuv420p. HEVC(H.265), ProRes, 일부 MOV/AVI 파일은 미리보기에서 직접 재생되지 않습니다.'}
            </div>
          )}
          {!reply?.supported && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={onConvert}
                disabled={transcoding}
                className={[
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  transcoding
                    ? 'bg-yellow-500/30 cursor-wait'
                    : 'bg-yellow-400 text-ink-950 hover:bg-yellow-300',
                ].join(' ')}
              >
                {transcoding
                  ? `변환 중... ${transcodePct.toFixed(0)}%`
                  : '권장 형식으로 변환하기'}
              </button>
              {transcoding && (
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-yellow-500/20">
                  <div
                    className="h-full bg-yellow-300 transition-all"
                    style={{ width: `${transcodePct}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
