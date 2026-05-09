import { templates, mvpReadyTemplateIds } from '../templates/templates';
import { useProjectStore } from '../store/projectStore';

export default function TemplateGallery(): JSX.Element {
  const selected = useProjectStore((s) => s.selectedTemplateId);
  const setSelected = useProjectStore((s) => s.setSelectedTemplate);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {templates.map((t) => {
        const active = t.id === selected;
        const ready = mvpReadyTemplateIds.has(t.id);
        return (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={[
              'relative flex aspect-[9/16] flex-col overflow-hidden rounded-lg border text-left transition-all',
              active
                ? 'border-accent ring-2 ring-accent/50'
                : 'border-white/10 hover:border-white/30',
            ].join(' ')}
            style={{ backgroundColor: t.cardBg }}
          >
            <div className="flex flex-1 items-end p-2">
              <div
                className="text-[10px] font-bold leading-tight"
                style={{ color: t.lyricColor }}
              >
                Lyric
                <br />
                <span style={{ color: t.lyricSubColor }}>가사</span>
              </div>
            </div>
            <div className="bg-black/30 px-2 py-1 text-[10px]">
              <div className="truncate font-medium" style={{ color: '#fff' }}>
                {t.name}
              </div>
              {!ready && (
                <div className="text-[8px] uppercase tracking-wider text-white/50">beta</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
