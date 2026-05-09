interface Props {
  lyricsRaw: string;
  onChangeRaw: (s: string) => void;
  highlightKorean: boolean;
  onChangeHighlightKorean: (v: boolean) => void;
}

export default function LyricsEditor(props: Props): JSX.Element {
  return (
    <div>
      <div className="mb-2 text-xs text-white/50">
        한 줄에 영어 가사, 다음 줄에 한국어 번역 (선택). 빈 줄로 구분.
      </div>
      <textarea
        value={props.lyricsRaw}
        onChange={(e) => props.onChangeRaw(e.target.value)}
        rows={8}
        className="w-full rounded-md border border-white/10 bg-ink-800 p-3 font-mono text-sm leading-relaxed placeholder:text-white/30 focus:border-white/40 focus:outline-none"
        placeholder={`I'll be there for you\n네 옆에 있을게\n\nWhen the rain starts to pour\n비가 쏟아지기 시작할 때`}
        spellCheck={false}
      />
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-white/70">
        <input
          type="checkbox"
          checked={props.highlightKorean}
          onChange={(e) => props.onChangeHighlightKorean(e.target.checked)}
        />
        한국어 자막 노란색 강조
      </label>
    </div>
  );
}
