import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Phase 5-13 — macOS first-launch helper modal.
 *
 * Shows ONCE on the first successful launch on macOS. Users who
 * see this modal already got past Gatekeeper, so the modal is
 * forward-looking: next time an update arrives or they share the
 * app with a friend, here's the path that works.
 *
 * UX priority (revised Phase 5-13.3 per user feedback):
 *
 *   1. PRIMARY — "시스템 설정 → 개인정보 및 보안 → 그래도 열기"
 *      One-click deep-link button to the right pane. This is the
 *      path Apple expects users to take — no terminal, no commands.
 *
 *      CRITICAL: the "Open Anyway" button only appears in System
 *      Settings AFTER the user has attempted to launch the app at
 *      least once. We call this out prominently so users don't
 *      jump straight to Settings and find the button missing.
 *
 *   2. ADVANCED — `.command` file in the DMG.
 *      Demoted to a collapsible section. Only useful for the rare
 *      "손상되었기 때문에 열 수 없습니다" case where the System
 *      Settings path doesn't expose the "Open Anyway" button.
 *
 * Storage: localStorage flag `lsm.firstLaunchMacHelperShown` so
 * the modal never re-appears after the user closes it.
 */
export default function FirstLaunchMacHelper(): JSX.Element | null {
  const [show, setShow] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const openSecurityPane = async () => {
    // Modern Sonoma/Sequoia deep link first; older Ventura URL as
    // fallback. Both land on Privacy & Security.
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
        className="max-h-[90vh] w-[min(560px,92vw)] overflow-auto rounded-lg border border-white/10 bg-ink-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center gap-2">
          <span aria-hidden className="text-xl">🍎</span>
          <div>
            <div className="text-[15px] font-semibold">
              macOS에서 실행해주셔서 감사합니다
            </div>
            <div className="text-[11px] text-white/50">
              이미 첫 실행은 성공했어요. 다음 업데이트 때 같은 경고가 뜨면
              아래 순서대로 하시면 됩니다.
            </div>
          </div>
        </div>

        {/* PRIMARY PATH — System Settings */}
        <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              권장
            </span>
            <span className="text-[13px] font-semibold">
              시스템 설정 → 개인정보 및 보안 → "그래도 열기"
            </span>
          </div>

          <ol className="space-y-2.5 text-[12.5px] text-white/85">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                1
              </span>
              <div>
                <span className="font-medium text-white">
                  Applications에서 앱을 한 번 더블클릭
                </span>
                해서 경고를 띄우고 "확인" 클릭 → 닫기
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                2
              </span>
              <div>아래 빨간 버튼을 누르면 시스템 설정 → 개인정보 및 보안이 열립니다</div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                3
              </span>
              <div>
                "보안" 섹션까지 스크롤 → "Lyric Shorts Maker 차단됨" 옆의{' '}
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium">
                  그래도 열기
                </span>{' '}
                클릭 → 비밀번호/Touch ID 인증
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                4
              </span>
              <div>한 번 더 뜨는 확인창에서 "열기" 클릭 — 끝</div>
            </li>
          </ol>

          {/* Critical pitfall note */}
          <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11.5px] text-amber-100">
            <div className="mb-0.5 font-semibold">⚠️ 꼭 기억하세요</div>
            <div className="text-amber-100/85">
              "그래도 열기" 버튼은{' '}
              <span className="font-semibold">1번 단계에서 앱을 한 번 실행 시도한 뒤</span>
              에만 시스템 설정에 나타납니다. 바로 시스템 설정으로 가면 그 버튼이 안 보여요.
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={openSecurityPane}
              className="rounded-md bg-red-500 px-4 py-2 text-[12.5px] font-semibold text-white shadow-md hover:bg-red-400"
            >
              🛡 시스템 설정 → 개인정보 및 보안 열기
            </button>
          </div>
        </div>

        {/* ADVANCED — collapsible .command path */}
        <details
          className="mt-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11.5px]"
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none text-white/55 hover:text-white/80">
            고급 옵션 — "손상되었기 때문에 열 수 없습니다" 메시지가 뜨는 경우
          </summary>
          <div className="mt-2 space-y-2 text-white/70">
            <p>
              드물게 "그래도 열기" 버튼이 시스템 설정에 안 나타날 수 있어요
              (보통 다운로드 중 격리 속성이 잘못 붙은 경우).
            </p>
            <p>
              그럴 땐 다운로드 받으셨던{' '}
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">.dmg</span>{' '}
              파일을 다시 열어서{' '}
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
                Unblock Lyric Shorts Maker.command
              </span>{' '}
              파일을 더블클릭하세요. 터미널 창이 잠깐 열렸다 닫히면서 자동으로
              해결됩니다. 명령어를 입력할 필요는 없습니다.
            </p>
          </div>
        </details>

        {/* Why + diagnostics footer */}
        <div className="mt-4 space-y-2 text-[11.5px] text-white/55">
          <p>
            <span className="text-white/75">왜 이런 경고가 뜨나요?</span> 아직
            Apple Developer ID 인증서가 없는 RC 테스트 빌드입니다. 정식 V1.0.0부터는
            인증서가 적용되어 경고 없이 바로 실행됩니다.
          </p>
          <p>
            문제가 생기면 시작 화면의{' '}
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
              🛠 진단 / 업데이트
            </span>{' '}
            → "📋 오류 복사하기"로 로그를 받아 GitHub Issue에 붙여주세요.
          </p>
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
