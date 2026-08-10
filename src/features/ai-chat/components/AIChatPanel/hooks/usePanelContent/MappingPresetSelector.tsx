/**
 * MappingPresetSelector — T-141631 / ADR-0031 follow-up.
 * One <select> replacing the 4-dropdown manual mapping UX. Falls back to
 * "Свой маппинг" which lets the parent show the legacy manual editor.
 */
import React from 'react';
import {
  CHAT_SOURCE_PRESETS,
  detectMatchingPreset,
  getApplicablePresets,
  resolvePreset,
  type ChatSourceKind,
  type ChatSourcePreset,
} from '../../../../utils/chatSourcePresets';

const CUSTOM_VALUE = '__custom__';

export interface MappingPresetSelectorProps {
  kind: ChatSourceKind;
  tableId: number;
  currentPreset?: string;
  currentMapping: Record<string, string | undefined>;
  availableColumns: Array<{ name?: string; column_name?: string; display_name?: string }>;
  onSelectPreset: (presetId: string, resolvedMapping: Record<string, string | undefined>, preset: ChatSourcePreset) => void;
  onSelectCustom: () => void;
}

export function MappingPresetSelector({
  kind,
  tableId,
  currentPreset,
  currentMapping,
  availableColumns,
  onSelectPreset,
  onSelectCustom,
}: MappingPresetSelectorProps) {
  const applicable = React.useMemo(
    () => getApplicablePresets(kind, tableId, CHAT_SOURCE_PRESETS),
    [kind, tableId],
  );

  const selectedValue = React.useMemo(() => {
    if (currentPreset && applicable.some(p => p.id === currentPreset)) return currentPreset;
    const detected = detectMatchingPreset(currentMapping, applicable, kind, tableId, availableColumns);
    return detected || CUSTOM_VALUE;
  }, [currentPreset, applicable, currentMapping, kind, tableId, availableColumns]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === CUSTOM_VALUE) {
      onSelectCustom();
      return;
    }
    const preset = applicable.find(p => p.id === value);
    if (!preset) return;
    const resolved = resolvePreset(preset, availableColumns);
    onSelectPreset(preset.id, resolved, preset);
  };

  return (
    <div>
      <label className="block text-[10px] text-[var(--text-tertiary)] mb-1 uppercase font-medium">Пресет</label>
      <select
        value={selectedValue}
        onChange={handleChange}
        className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
      >
        {applicable.map(p => (
          <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
        ))}
        <option value={CUSTOM_VALUE}>— Свой маппинг —</option>
      </select>
    </div>
  );
}
