import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Phase 5-13.4 — macOS first-launch helper.
 *
 * Shows ONCE on macOS after Gatekeeper was bypassed somehow. The
 * earlier (5-13.3) version put "System Settings → Privacy &
 * Security → 그래도 열기" as the primary path. That turned out to
 * be Sonoma-and-earlier behavior — macOS 15 (Sequoia) tightened
 * Gatekeeper enforcement and now classifies ad-hoc-signed
 * quarantined apps as "damaged" instead of "unidentified
 * developer," which means the "Open Anyway" button never appears
 * in System Settings.
 *
 * Revised priority:
 *
 *   1. PRIMARY — the `.command` file inside the DMG.
 *      It runs `xattr -dr com.apple.quarantine` + `open`. Works on
 *      every macOS version (Sonoma, Sequoia, future). Terminal-free
 *      for the user (a console window flashes by). This is the only
 *      reliable no-cost path on Sequoia 15.x.
 *
 *   2. SECONDARY (Sonoma 14 or earlier) — System Settings.
 *      Still works on Sonoma + earlier. Collapsed by default; users
 *      on those versions can expand it.
 *
 *   3. TERMINAL (last resort, "even the .command got damaged") —
 *      one-liner xattr command. Inside the secondary collapsible
 *      since it's a power-user fallback.
 *
 * The modal acknowledges that the user already got past the OS
 * warning somehow — this is forward-looking guidance for next
 * update / sharing with friends.
 */
export default function FirstLaunchMacHelper(): JSX.Element | null {
  const [show, setShow] = useState(false);

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

  // Best-effort macOS version detection from UA. Sequoia is 15.x;
  // we treat anything we can't parse as "modern + strict" and show
  // the .command path as primary. Only Sonoma 14.x (and older)
  // users get the System Settings path called out as a viable
  // alternative.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const m = /Mac OS X (\d+)[._](\d+)/.exec(ua);
  const macMajor = m ? parseInt(m[1], 10) : null;
  const isSequoiaOrLater = macMajor !== null && macMajor >= 15;
  const isSonomaOrEarlier = macMajor !== null && macMajor <= 14;

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
            <div className="text-[15px] font-semibold">
              macOS에서 실행해주셔서 감사합니다
            </div>
            <div className="mt-0.5 text-[11px] text-white/55">
              이미 첫 실행은 성공했어요. 다음 업데이트나 친구와 공유하실 때
              같은 경고가 뜨면 아래대로 하시면 됩니다.
            </div>
          </div>
        </div>

        {/* PRIMARY PATH — .command file */}
        <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              권장 · 모든 macOS
            </span>
            <span className="text-[13px] font-semibold">
              "손상되었습니다" 경고가 뜨면?
            </span>
          </div>

          <ol className="space-y-3 text-[12.5px] text-white/85">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                1
              </span>
              <div>
                다운로드 받으셨던{' '}
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
                  .dmg
                </span>{' '}
                파일을 다시 더블클릭해서 여세요
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                2
              </span>
              <div>
                DMG 창 안에 있는{' '}
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium">
                  Unblock Lyric Shorts Maker.command
                </span>{' '}
                파일을 더블클릭
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                3
              </span>
              <div>
                터미널 창이 잠깐 열리며 "✓ 완료" 표시 → 엔터 → 앱 자동 실행
              </div>
            </li>
          </ol>

          <div className="mt-4 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11.5px] text-emerald-100">
            <div className="mb-0.5 font-semibold">💡 명령어 입력 필요 없음</div>
            <div className="text-emerald-100/85">
              터미널이 잠깐 열리긴 하지만 사용자가 직접 무언가 입력할 필요는
              없습니다. 더블클릭 한 번 + 엔터 한 번이면 끝.
            </div>
          </div>
        </div>

        {/* SECONDARY — System Settings (Sonoma 14 only) */}
        <details
          className="mt-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11.5px]"
          open={isSonomaOrEarlier}
        >
          <summary className="cursor-pointer select-none text-white/55 hover:text-white/80">
            macOS 14 (Sonoma) 이전 사용자 — "시스템 설정 → 그래도 열기" 경로
          </summary>
          <div className="mt-2 space-y-2 text-white/70">
            <p>
              Sonoma 14.x 이전 macOS에서는{' '}
              <span className="text-white">시스템 설정 → 개인정보 및 보안 →
              "그래도 열기"</span>{' '}
              로도 실행할 수 있습니다. Sequoia (15.x) 부터는 Apple이 이 경로를
              막아서 작동하지 않으므로 위의 .command 방식을 써주세요.
            </p>
            <ol className="space-y-1.5 pl-4 text-[11.5px]">
              <li>1. Applications에서 앱 한 번 더블클릭 → 경고 → "확인"</li>
              <li>2. 아래 버튼 → 시스템 설정 → 개인정보 및 보안</li>
              <li>
                3. "보안" 섹션까지 스크롤 → "Lyric Shorts Maker 차단됨" 옆의{' '}
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">
                  그래도 열기
                </span>{' '}
                클릭 → 비밀번호/Touch ID
              </li>
              <li>4. 한 번 더 뜨는 확인창에서 "열기"</li>
            </ol>
            <p className="text-[11px] text-amber-200/80">
              ⚠️ "그래도 열기" 버튼은 1단계에서 앱을 한 번 실행 시도한 뒤에만
              시스템 설정에 나타납니다.
            </p>
            <button
              onClick={async () => {
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
              }}
              className="mt-1 rounded-md bg-white/10 px-3 py-1.5 text-[11.5px] hover:bg-white/15"
            >
              🛡 시스템 설정 → 개인정보 및 보안 열기
            </button>
          </div>
        </details>

        {/* Terminal fallback */}
        <details className="mt-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11.5px]">
          <summary className="cursor-pointer select-none text-white/55 hover:text-white/80">
            .command 파일조차 안 되면? (마지막 수단)
          </summary>
          <div className="mt-2 space-y-2 text-white/70">
            <p>
              아주 드물게 .command 파일도 격리되는 경우가 있어요. 그땐 한 번만
              터미널 명령이 필요합니다:
            </p>
            <ol className="space-y-1 pl-4 text-[11.5px]">
              <li>Spotlight (⌘+Space) → "터미널" → 엔터</li>
              <li>아래 한 줄을 복사 → 터미널에 붙여넣기 → 엔터</li>
            </ol>
            <pre className="overflow-x-auto rounded-md bg-black/40 px-3 py-2 text-[10.5px] text-emerald-200">
              xattr -dr com.apple.quarantine "/Applications/Lyric Shorts Maker.app"
            </pre>
            <p>Mac 사용자 비밀번호 입력 → 그 후 응용 프로그램에서 더블클릭으로 정상 실행.</p>
          </div>
        </details>

        {/* Why footer */}
        <div className="mt-4 text-[11px] text-white/50">
          <span className="text-white/70">왜?</span> 아직 Apple Developer ID
          인증서가 없는 RC 빌드입니다. macOS{' '}
          {isSequoiaOrLater
            ? 'Sequoia (15.x)부터 Apple이 미인증 앱 실행을 더 엄격하게 막아서'
            : '안전 정책상'}{' '}
          첫 실행 시 사용자 확인이 필요합니다. 정식 V1.0.0에서는 인증서를
          적용해 경고 없이 바로 실행되도록 할 예정입니다.
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
