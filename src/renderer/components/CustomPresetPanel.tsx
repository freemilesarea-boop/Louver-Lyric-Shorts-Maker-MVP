import { useEffect, useState } from 'react';
import {
  effectiveAnimation,
  effectiveFx,
  effectiveMotion,
  effectiveReactive,
  selectedTemplate,
  useProjectStore,
} from '../store/projectStore';
import { api } from '../lib/api';
import { prettyErrorMessage } from '../../shared/errors';
import type { CustomPreset } from '../../shared/types';

/**
 * "내 프리셋" — save the current Style Controls combo as a named preset,
 * load existing presets back into the editor, and delete the ones you
 * don't want anymore.
 *
 * The store pieces this needs:
 *   - effective{Motion, Animation, Reactive, Fx} for capturing current state
 *   - manualLanguage so saved presets can carry a language override
 *   - setSelectedTemplate / setManual* for applying loaded presets
 */
export default function CustomPresetPanel(): JSX.Element {
  const template = useProjectStore(selectedTemplate);
  const motion = useProjectStore(effectiveMotion);
  const animation = useProjectStore(effectiveAnimation);
  const reactive = useProjectStore(effectiveReactive);
  const fx = useProjectStore(effectiveFx);
  const manualLanguage = useProjectStore((s) => s.manualLanguage);
  const styleOverrides = useProjectStore((s) => s.styleOverrides);
  const layoutOverrides = useProjectStore((s) => s.layoutOverrides);
  const setSelectedTemplate = useProjectStore((s) => s.setSelectedTemplate);
  const setManualMotionPreset = useProjectStore((s) => s.setManualMotionPreset);
  const setManualAnimationPreset = useProjectStore((s) => s.setManualAnimationPreset);
  const setManualReactiveMode = useProjectStore((s) => s.setManualReactiveMode);
  const setManualFxPreset = useProjectStore((s) => s.setManualFxPreset);
  const setManualLanguage = useProjectStore((s) => s.setManualLanguage);
  const setStyleOverrides = useProjectStore((s) => s.setStyleOverrides);
  const resetStyleOverrides = useProjectStore((s) => s.resetStyleOverrides);
  const setLayoutOverride = useProjectStore((s) => s.setLayoutOverride);
  const resetLayoutOverrides = useProjectStore((s) => s.resetLayoutOverrides);

  const [name, setName] = useState('');
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api().listCustomPresets();
      setPresets(list);
    } catch (e) {
      setError(prettyErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onSave = async () => {
    setError(null);
    setStatus(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('프리셋 이름을 입력해주세요.');
      return;
    }
    const input = {
      name: trimmed,
      templateId: template.id,
      motionPreset: motion,
      animationPreset: animation,
      reactiveMode: reactive,
      cinematicFxPreset: fx,
      language: manualLanguage,
      styleOverrides,
      layoutOverrides,
    };
    try {
      let reply = await api().saveCustomPreset(input);
      if (!reply.ok && reply.conflict) {
        const ok = window.confirm(
          `"${trimmed}" 이름의 프리셋이 이미 있어요. 덮어쓸까요?`,
        );
        if (!ok) return;
        reply = await api().saveCustomPreset({ ...input, forceOverwrite: true });
      }
      if (!reply.ok) {
        setError(reply.error ?? '프리셋 저장에 실패했습니다.');
        return;
      }
      setName('');
      setStatus(`"${reply.preset?.name}" 저장됨`);
      refresh();
    } catch (e) {
      setError(prettyErrorMessage(e));
    }
  };

  const onLoad = (p: CustomPreset) => {
    setSelectedTemplate(p.templateId);
    setManualMotionPreset(p.motionPreset);
    setManualAnimationPreset(p.animationPreset);
    setManualReactiveMode(p.reactiveMode);
    setManualFxPreset(p.cinematicFxPreset);
    setManualLanguage(p.language ?? null);
    // Restore the saved style tweaks. Older presets without this field
    // reset to template defaults.
    if (p.styleOverrides && Object.keys(p.styleOverrides).length > 0) {
      // Reset first so a saved preset's "intentionally unset" knob doesn't
      // inherit the user's current override for that knob.
      resetStyleOverrides();
      setStyleOverrides(p.styleOverrides);
    } else {
      resetStyleOverrides();
    }
    // Same pattern for layoutOverrides — Phase 5-5+.
    resetLayoutOverrides();
    if (p.layoutOverrides) {
      for (const [key, point] of Object.entries(p.layoutOverrides) as Array<
        [
          'lyric' | 'meta' | 'waveform',
          { x: number; y: number } | undefined,
        ]
      >) {
        if (point) setLayoutOverride(key, point);
      }
    }
    setStatus(`"${p.name}" 적용됨`);
  };

  const onDelete = async (p: CustomPreset) => {
    if (!window.confirm(`"${p.name}" 프리셋을 삭제할까요?`)) return;
    try {
      await api().deleteCustomPreset(p.id);
      setStatus(`"${p.name}" 삭제됨`);
      refresh();
    } catch (e) {
      setError(prettyErrorMessage(e));
    }
  };

  return (
    <div className="space-y-2">
      {/* save row */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="프리셋 이름 (예: 내 발라드 스타일)"
          maxLength={60}
          className="flex-1 rounded-md border border-white/10 bg-ink-800 px-2.5 py-1.5 text-xs placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
          }}
        />
        <button
          onClick={onSave}
          disabled={!name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-soft disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
          title="현재 Style Controls 조합을 저장"
        >
          ＋ 저장
        </button>
      </div>

      <div className="text-[11px] text-white/40">
        템플릿 + motion + animation + reactive + FX + 언어 오버라이드를 함께 저장합니다.
      </div>

      {/* status / error */}
      {status && <div className="text-[11px] text-emerald-300">{status}</div>}
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          {error}
        </div>
      )}

      {/* list */}
      <div className="rounded-md border border-white/5 bg-ink-800/40">
        {loading ? (
          <div className="p-3 text-[11px] text-white/40">불러오는 중...</div>
        ) : presets.length === 0 ? (
          <div className="p-3 text-[11px] text-white/40">
            저장된 프리셋이 없어요. 이름을 입력하고 ＋ 저장을 눌러보세요.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {presets.map((p) => (
              <PresetRow key={p.id} preset={p} onLoad={() => onLoad(p)} onDelete={() => onDelete(p)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PresetRow(props: {
  preset: CustomPreset;
  onLoad: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { preset, onLoad, onDelete } = props;
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{preset.name}</div>
        <div className="truncate text-[10px] text-white/40">
          {preset.templateId} · motion={preset.motionPreset} · anim={preset.animationPreset} · fx={preset.cinematicFxPreset}
          {preset.language ? ` · lang=${preset.language}` : ''}
        </div>
      </div>
      <button
        onClick={onLoad}
        className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/15"
        title="이 프리셋으로 Editor 적용"
      >
        불러오기
      </button>
      <button
        onClick={onDelete}
        className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/60 hover:bg-red-500/20 hover:text-red-200"
        title="삭제"
      >
        삭제
      </button>
    </li>
  );
}
