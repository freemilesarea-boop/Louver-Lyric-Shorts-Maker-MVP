/**
 * Best-effort translation of raw ffmpeg / pipeline errors into a single line
 * that an end user can act on. Falls back to the first line of the raw
 * message when no rule matches.
 *
 * Used by both main process (pipeline → IPC error reply) and renderer
 * (final UI render) so the same Korean copy shows everywhere.
 */
export function prettyErrorMessage(raw: unknown): string {
  if (raw == null) return '알 수 없는 오류가 발생했습니다.';
  const text = (raw instanceof Error ? raw.message : String(raw)).trim();
  if (!text) return '알 수 없는 오류가 발생했습니다.';
  const r = text.toLowerCase();

  // Permission / write issues
  if (r.includes('permission denied') || r.includes('eacces') || r.includes('eperm')) {
    return '저장 위치에 쓰기 권한이 없습니다. 다른 폴더를 선택해주세요.';
  }
  if (r.includes('enospc') || r.includes('disk full') || r.includes('no space')) {
    return '저장 공간이 부족합니다. 디스크를 정리한 뒤 다시 시도해주세요.';
  }
  if (r.includes('out of memory') || r.includes('enomem')) {
    return '메모리가 부족합니다. 다른 앱을 닫고 다시 시도해주세요.';
  }

  // Missing / unreadable files
  if (
    r.includes('no such file') ||
    r.includes('enoent') ||
    r.includes('찾을 수 없') ||
    r.includes('not found')
  ) {
    if (r.includes('image') || /\.(jpe?g|png|webp)/.test(r)) {
      return '이미지 파일을 다시 선택해주세요. (파일이 옮겨졌거나 삭제되었을 수 있어요)';
    }
    if (r.includes('audio') || /\.(mp3|wav|m4a|aac|flac|ogg)/.test(r)) {
      return '오디오 파일을 읽을 수 없습니다. 다시 선택해주세요.';
    }
    return '입력 파일을 찾을 수 없습니다. 다시 선택해주세요.';
  }

  // Corrupt / unsupported input formats
  if (
    r.includes('invalid data') ||
    r.includes('moov atom not found') ||
    r.includes('invalid argument') && r.includes('codec')
  ) {
    return '오디오 또는 이미지 형식이 올바르지 않아요. 다른 파일로 시도해주세요.';
  }

  // Cancellation
  if (r.includes('sigterm') || r.includes('sigkill') || r.includes('cancelled')) {
    return '렌더가 중단되었습니다.';
  }

  // ffmpeg specifically
  if (r.includes('ffmpeg failed') || r.includes('ffmpeg 렌더 실패')) {
    return `ffmpeg 렌더 실패: 출력 폴더 / 입력 파일 / 디스크 공간을 확인해주세요.`;
  }

  // Lyric / time-range overflow (renderer-side validation surface)
  if (r.includes('가사 시간') || r.includes('lyric time')) {
    return '가사 시간이 영상 길이를 초과했습니다. 타임라인을 조정해주세요.';
  }

  // Whisper transcription errors
  if (r.includes('whisper') && r.includes('not installed')) {
    return 'Whisper가 설치되어 있지 않습니다. 자동 가사 추출 기능을 사용하려면 먼저 설치해주세요.';
  }
  if (r.includes('whisper') || r.includes('transcrib')) {
    return '가사 자동 추출에 실패했습니다. 음원이 짧거나 음질이 낮을 수 있어요. 수동 입력을 사용해주세요.';
  }

  // Default: first line, capped length.
  const firstLine = text.split(/\r?\n/)[0].slice(0, 240);
  return `렌더 중 오류가 발생했습니다: ${firstLine}`;
}
