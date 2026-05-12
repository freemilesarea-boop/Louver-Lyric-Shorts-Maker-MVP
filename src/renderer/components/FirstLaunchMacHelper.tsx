import { useEffect, useState } from 'react';

/**
 * Phase 5-13.5 — macOS first-launch helper modal.
 *
 * Shown ONCE on macOS after a successful launch. We can't rescue
 * users from Gatekeeper from inside the app (the app doesn't run
 * if Gatekeeper blocks it), so the modal is forward-looking — it
 * tells them what to do NEXT TIME the same warning appears
 * (e.g. after an update, or when sharing the build with a friend).
 *
 * Documented install path: `xattr -dr com.apple.quarantine "/Applications/Lyric Shorts Maker.app"`
 *
 * Why not the System Settings → "그래도 열기" path:
 *
 *   macOS 15 (Sequoia) classifies ad-hoc-signed quarantined apps as
 *   "damaged" instead of "unidentified developer", and the
 *   System Settings recovery button never appears. The only no-cost
 *   path that works on every macOS version is to strip the
 *   `com.apple.quarantine` xattr — which is what the documented
 *   xattr command does in one line. We tried (a) ad-hoc signing
 *   inline via electron-builder (still treated as damaged by
 *   Sequoia) and (b) a `.command` file in the DMG (Sequoia blocks
 *   that too). Both paths failed real user testing.
 *
 *   Real fix is Apple Developer ID ($99/year) + notarization,
 *   deferred to V1.0.0 final.
 *
 * UI primary action: a one-click "복사" button that puts the xattr
 * command on the clipboard. The user opens Terminal, pastes, hits
 * Enter, types password. Done.
 */
export default function FirstLaunchMacHelper(): JSX.Element | null {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const COMMAND = 'xattr -dr com.apple.quarantine "/Applications/Lyric Shorts Maker.app"';

  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac OS X|macOS|Macintosh/.test(navigator.userAgent);
    if (!isMac) return;
    try {
      if (localStorage.getItem('lsm.firstLaunchMacHelperShown') === '1') return;
    } catch {
      /* private mode — show once per session */
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

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard API blocked; user can select manually */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="max-h-[90vh] w-[min(580px,92vw)] overflow-auto rounded-lg border border-white/10 bg-ink-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">🍎</span>
          <div>
            <div className="text-[15px] font-semibold">macOS 실행 안내</div>
            <div className="mt-0.5 text-[11px] text-white/55">
              이미 실행은 성공했어요. 다음 업데이트 / 다른 Mac에 설치하실 때
              같은 경고가 뜨면 아래 한 줄을 사용하세요.
            </div>
          </div>
        </div>

        {/* PRIMARY — xattr command */}
        <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              설치 명령
            </span>
            <span className="text-[13px] font-semibold">
              터미널 한 번, 그 후로는 더블클릭만
            </span>
          </div>

          <ol className="mb-3 space-y-2 text-[12.5px] text-white/85">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                1
              </span>
              <div>
                Spotlight (⌘+Space) → "터미널" 입력 → Enter
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                2
              </span>
              <div>
                아래 명령을 터미널에 붙여넣고 Enter (사용자 비밀번호 입력 필요)
              </div>
            </li>
          </ol>

          {/* Copy box */}
          <div className="mb-2 flex items-stretch gap-2">
            <pre className="flex-1 overflow-x-auto rounded-md border border-white/10 bg-black/40 px-3 py-2 text-[10.5px] leading-relaxed text-emerald-200">
              {COMMAND}
            </pre>
            <button
              onClick={copyCommand}
              className="shrink-0 rounded-md bg-red-500 px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-red-400"
            >
              {copied ? '✓ 복사됨' : '📋 복사'}
            </button>
          </div>

          <div className="text-[11px] text-white/50">
            한 번 실행하면 끝입니다 — 다음부터는 응용 프로그램 폴더에서
            그냥 더블클릭하면 정상 실행됩니다.
          </div>
        </div>

        {/* Why footer */}
        <div className="mt-4 text-[11px] text-white/50">
          <span className="text-white/75">왜 터미널 한 줄이 필요한가요?</span>{' '}
          아직 Apple Developer ID 인증서 ($99/년)가 없는 RC 빌드입니다. macOS
          Sequoia (15.x)부터 Apple이 미인증 앱 실행을 매우 엄격하게 막아서
          GUI 경로 (시스템 설정 "그래도 열기")가 작동하지 않습니다. 위 한
          줄은 macOS의 quarantine 격리 속성을 한 번만 제거합니다. 정식
          V1.0.0부터는 Developer ID를 적용해 이 단계가 불필요하게 됩니다.
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={dismiss}
            className="rounded-md bg-white/10 px-4 py-1.5 text-[12px] hover:bg-white/15"
          >
            알겠어요
          </button>
        </div>
      </div>
    </div>
  );
}
