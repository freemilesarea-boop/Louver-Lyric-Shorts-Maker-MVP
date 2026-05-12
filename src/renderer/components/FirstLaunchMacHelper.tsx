import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Phase 5-13 — macOS first-launch helper modal.
 *
 * Shows ONCE on the first successful launch when running on macOS.
 * Users who saw this modal already got past Gatekeeper, so the
 * point isn't "explain the warning" — it's:
 *
 *   1. Acknowledge that they had to bypass a warning, and that the
 *      warning was a normal RC-build artifact (no Apple Developer
 *      ID yet), not malware.
 *   2. Tell them where the diagnostics live so they can report
 *      issues without hunting.
 *   3. Give them a one-click "시스템 설정 → 개인정보 및 보안" link
 *      so if they get the "차단됨" toast on a relaunch (sometimes
 *      macOS re-quarantines on update), they can grant Open Anyway
 *      without terminal.
 *
 * The "open System Settings" deep link is `x-apple.systempreferences:
 * com.apple.settings.PrivacySecurity.extension` on Sonoma/Sequoia,
 * with the older `com.apple.preference.security?Privacy` as fallback
 * for Ventura. main process tries both.
 *
 * Storage: localStorage flag `lsm.firstLaunchMacHelperShown` so the
 * modal never re-appears after the user closes it. If they delete
 * the app data dir or run a fresh install, it shows again — that's
 * desired.
 */
export default function FirstLaunchMacHelper(): JSX.Element | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Gate on platform + first-launch flag. We resolve platform from
    // navigator.userAgent rather than ipc so the modal can decide
    // immediately on mount (no flash).
    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac OS X|macOS|Macintosh/.test(navigator.userAgent);
    if (!isMac) return;
    try {
      if (localStorage.getItem('lsm.firstLaunchMacHelperShown') === '1') return;
    } catch {
      // Private mode or storage disabled — just show it once per
      // session in that case.
    }
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem('lsm.firstLaunchMacHelperShown', '1');
    } catch {
      /* noop */
    }
    setShow(false);
  };

  const openSecurityPane = async () => {
    // Tries the modern Sonoma deep link first, then Ventura fallback.
    // We do both via ipc so the renderer doesn't expose shell.openExternal
    // to arbitrary URLs (already covered by api.openExternal but
    // these are the two URLs we actually care about).
    const candidates = [
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension',
      'x-apple.systempreferences:com.apple.preference.security?Privacy',
    ];
    for (const url of candidates) {
      try {
        await api().openExternal(url);
        break;
      } catch {
        /* try next */
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="max-w-md rounded-lg border border-white/10 bg-ink-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          <span aria-hidden>🍎</span>
          <span>macOS에서 실행해주셔서 감사합니다</span>
        </div>

        <div className="space-y-3 text-[13px] leading-relaxed text-white/80">
          <p>
            방금 "확인되지 않은 개발자" 또는 비슷한 경고를 통과하셨을
            거예요. Lyric Shorts Maker RC.1은 아직{' '}
            <span className="text-white">Apple Developer ID 인증서가 없는</span>{' '}
            테스트 빌드라서 그렇습니다. 정식 V1.0.0부터는 인증서가
            적용되어 경고 없이 바로 실행됩니다.
          </p>

          <p className="rounded-md bg-white/5 px-3 py-2 text-[12px]">
            <span className="font-semibold text-white">참고:</span> 만약
            업데이트 후 다시 "차단됨" 알림이 뜨면 아래 버튼을 눌러서
            시스템 설정에서 한 번 더 "그래도 열기"를 클릭하시면 됩니다.
            터미널 명령은 필요 없습니다.
          </p>

          <p>
            문제가 생기면 시작 화면의{' '}
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
              🛠 진단 / 업데이트
            </span>{' '}
            → <span className="text-white">📋 오류 복사하기</span> 로
            로그를 받아 GitHub Issue에 붙여주시면 정확히 어디서 깨졌는지
            보고 패치해드립니다.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={openSecurityPane}
            className="rounded-md bg-white/10 px-3 py-1.5 text-[12px] hover:bg-white/15"
          >
            🛡 시스템 설정 → 개인정보 및 보안
          </button>
          <button
            onClick={dismiss}
            className="rounded-md bg-red-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-400"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
