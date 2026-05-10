import { useState } from 'react';

const HELP_DISMISS_KEY = 'louver-lyric.help.dismissed.v1';

/**
 * 5-step quick guide shown on the Start screen. Dismissable; once
 * dismissed it stays hidden via localStorage. The "다시 보기" link
 * lower in the dismissed-state card lets the user bring it back.
 *
 * Pure UI — no IPC, no store mutations, no router changes.
 */
export default function HelpPanel(): JSX.Element {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(HELP_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem(HELP_DISMISS_KEY, '1');
    } catch {
      // ignore — non-fatal
    }
    setDismissed(true);
  };

  const reopen = () => {
    try {
      localStorage.removeItem(HELP_DISMISS_KEY);
    } catch {
      // ignore
    }
    setDismissed(false);
  };

  if (dismissed) {
    return (
      <button
        onClick={reopen}
        className="text-[11px] text-white/40 hover:text-white/70"
        title="처음 사용 안내 다시 보기"
      >
        ? 사용 안내 보기
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-ink-900/70 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold tracking-tight">처음 사용하시나요?</h3>
        <button
          onClick={dismiss}
          className="text-[11px] text-white/40 hover:text-white/70"
          title="다시 보지 않기"
        >
          ⨯ 닫기
        </button>
      </header>
      <ol className="grid grid-cols-1 gap-2 text-xs text-white/70 sm:grid-cols-5">
        <Step n={1}>사진 선택<br /><span className="text-white/40">JPG · PNG</span></Step>
        <Step n={2}>음원 선택<br /><span className="text-white/40">MP3 · WAV · M4A</span></Step>
        <Step n={3}>가사 입력<br /><span className="text-white/40">또는 ✨ AI 추출</span></Step>
        <Step n={4}>템플릿 선택<br /><span className="text-white/40">10개 + 샘플 프리셋</span></Step>
        <Step n={5}>출력<br /><span className="text-white/40">단일 또는 배치</span></Step>
      </ol>
      <p className="mt-3 text-[11px] leading-relaxed text-white/50">
        • 음원을 길게 넣어도 ‘🎯 하이라이트 구간 추천’ 으로 좋은 부분을 자동으로 찾을 수 있어요.
        <br />
        • Safe Zone 미리보기로 Shorts/Reels/TikTok UI에 가려지지 않는지 확인할 수 있어요.
      </p>
    </section>
  );
}

function Step(props: { n: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-md border border-white/5 bg-ink-800/50 p-2.5">
      <div className="mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-ink-950">
        {props.n}
      </div>
      <div className="leading-snug">{props.children}</div>
    </div>
  );
}
