import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { shouldShowConvert } from './mediaValidationLogic';
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
    // Phase 5-8.2 — probe runs for ANY video kind, even when
    // forceShow is set. The forceShow path comes from a runtime
    // Chromium decode failure; we still want to surface the detected
    // codec / resolution / pixel format so the user knows what
    // they're looking at. Image / gif still skip ffprobe.
    if (props.kind !== 'video' && !props.forceShow) return;
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
  }, [props.path, props.kind, props.forceShow]);

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

  // Phase 5-8.2 — effective "needs convert" decision.
  //
  // The ffprobe classifier can say a file LOOKS fine (h264 + yuv420p),
  // but Chromium's runtime decoder is the final authority. When the
  // parent passes `forceShow=true` it's because the inner <video>
  // emitted a real `error` event or hit the 5s canplay watchdog — at
  // that point we always offer the convert button, even if the probe
  // verdict was "supported". This was the root cause of the user's
  // "버튼이 안 보여요" report on a 1920×3414 h264/yuv420p source: my
  // classifier said supported → banner suppressed → user stuck.
  //
  // The button stays as the primary CTA regardless of probe verdict;
  // the banner copy adapts based on whether the failure was detected
  // at probe time (we know the codec is in our reject list) or only
  // at decode time (probe passed but Chromium rejected anyway).
  const needsConvert = shouldShowConvert({
    probeSupported: reply === null ? null : reply.supported,
    forceShow: !!props.forceShow,
  });

  // Visibility: same as before EXCEPT forceShow now also pulls the
  // banner up before the probe has even resolved, since we don't want
  // the user staring at a busted preview with no UI at all.
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

  // Decide which copy to show. Three distinct cases:
  //   (a) probe says unsupported           → "지원하지 않는 형식"
  //   (b) probe says supported BUT forceShow → "재생할 수 없었어요"
  //                                            (Chromium-level fail)
  //   (c) probe still loading + forceShow  → generic "재생할 수 없었어요"
  const probeRejected = reply !== null && !reply.supported;
  const headline = probeRejected
    ? '미리보기에서 지원하지 않는 형식이에요.'
    : props.forceShow
      ? '이 영상을 미리보기에서 재생할 수 없었어요.'
      : '미리보기에 사용할 수 있는 영상이에요.';

  // Explanation: probe reason wins; otherwise we explain the
  // "looks-OK-but-Chromium-said-no" case in plain language.
  const explanation = probeRejected
    ? reply!.reason
    : props.forceShow
      ? '코덱/픽셀 포맷은 일반적으로 지원되는 값이지만 (h264 / yuv420p 등) Chromium ' +
        '내장 디코더가 이 파일을 거부했어요. 보통 다음 중 하나입니다:\n' +
        '  · MP4 메타데이터(moov atom)가 파일 끝에 있어 스트리밍 디코드가 안 되는 경우 ' +
        '(faststart 미적용 영상)\n' +
        '  · 해상도/프로파일/레벨이 Chromium 디코더 한계를 넘은 경우 (세로 매우 긴 영상 등)\n' +
        '  · 컨테이너에 추가 atom이 있어 디코더가 시작을 미루는 경우\n' +
        '"권장 형식으로 변환하기"를 누르면 ffmpeg가 안전한 mp4(faststart + ' +
        '8-bit yuv420p)로 다시 인코드해 즉시 재생되게 만들어 드려요.'
      : null;

  return (
    <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-[12px] leading-relaxed text-yellow-100">
      {probing && !reply && (
        <div className="flex items-center gap-2 text-yellow-200/80">
          <span>영상 정보를 확인하는 중...</span>
        </div>
      )}
      {(!probing || reply) && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{headline}</div>
          </div>
          {detected && (
            <div className="mt-1 text-[11px] text-yellow-200/80">
              감지된 형식: <span className="font-mono">{detected}</span>
            </div>
          )}
          {explanation && (
            <div className="mt-1 whitespace-pre-wrap text-[11px] text-yellow-200/80">
              {explanation}
            </div>
          )}
          {needsConvert && (
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
                  : '▶ 권장 형식으로 변환하기'}
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
