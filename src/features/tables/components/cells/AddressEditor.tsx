/**
 * ADR-0035-A — `address` cell editor (centered modal, like JsonEditor).
 *
 * `formatted` on top (autofocus, Enter saves), `name` beneath (accepts `{{column_key}}`,
 * stored as typed), a collapsible «Components» block with the eight structured fields.
 * `provider` / `provider_place_id` (reserved for slice B) pass through untouched.
 * Empty `formatted` → inline error, nothing is sent and nothing is lost.
 * Commits the JSON of the value through the grid's normal `onCommit(string)`; «Clear» commits ''.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useRef, useState } from 'react';
import type { AddressValue } from '../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ADDRESS_COMPONENT_KEYS, ADDRESS_RESERVED_KEYS, parseAddressDraft, parseAddressValue } from './AddressCell';

interface AddressEditorProps {
  /** The grid draft: JSON of the stored object, a plain address line, or ''. */
  value: string;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
}

type ComponentKey = (typeof ADDRESS_COMPONENT_KEYS)[number];

const FALLBACK_LABELS: Record<string, string> = {
  title: 'Address',
  formatted: 'Address line',
  formattedPlaceholder: 'Tverskaya 7, Moscow',
  name: 'Name',
  nameHint: 'Optional label. {{column_key}} is allowed and stored as typed.',
  components: 'Components',
  country_code: 'Country code',
  country: 'Country',
  region: 'Region',
  city: 'City',
  street: 'Street',
  building: 'Building',
  unit: 'Unit',
  postal_code: 'Postal code',
  required: 'The address line is required',
  save: 'Save',
  cancel: 'Cancel',
  clear: 'Clear',
};

/** Rows (and their editors) also mount outside a LanguageProvider (embeds, isolated tests): same hook call every render, no throw. */
const useSafeTranslate = (): ((key: string) => string) | null => {
  try {
    return useLanguage().t;
  } catch {
    return null;
  }
};

export const AddressEditor = ({ value, onCommit, onCancel }: AddressEditorProps) => {
  const t = useSafeTranslate();
  const label = (key: string): string => (t ? t(`columnSettings.address.editor.${key}`) : FALLBACK_LABELS[key] ?? key);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const initial = useMemo<AddressValue | null>(() => parseAddressValue(parseAddressDraft(value)), [value]);
  const [formatted, setFormatted] = useState(initial?.formatted ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [components, setComponents] = useState<Record<ComponentKey, string>>(() =>
    Object.fromEntries(ADDRESS_COMPONENT_KEYS.map((key) => [key, initial?.[key] ?? ''])) as Record<ComponentKey, string>
  );
  const [componentsOpen, setComponentsOpen] = useState(() => ADDRESS_COMPONENT_KEYS.some((key) => Boolean(initial?.[key])));
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const line = formatted.trim();
    if (!line) {
      setError(label('required'));
      return;
    }
    const next: Record<string, string> = {};
    // Reserved keys first so they survive the round-trip exactly as stored.
    for (const key of ADDRESS_RESERVED_KEYS) {
      const kept = initial?.[key];
      if (kept) next[key] = kept;
    }
    next.formatted = line;
    const trimmedName = name.trim();
    if (trimmedName) next.name = trimmedName;
    for (const key of ADDRESS_COMPONENT_KEYS) {
      const v = components[key].trim();
      if (v) next[key] = v;
    }
    onCommit(JSON.stringify(next));
  };

  const handleClear = () => onCommit('');

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="address-editor"
          onClick={(event) => event.stopPropagation()}
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              handleSave();
            }
          }}
          className="fixed left-1/2 top-1/2 z-[100] flex max-h-[90dvh] w-[100vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl sm:w-[90vw] sm:max-w-lg sm:rounded-lg"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-2">
            <Dialog.Title className="text-sm font-medium text-[var(--text-primary)]">📮 {label('title')}</Dialog.Title>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <label className="block space-y-1">
              <span className="block text-xs font-medium text-[var(--text-secondary)]">{label('formatted')}</span>
              {/* First tabbable in the dialog → Radix focuses it on open (no autoFocus prop needed). */}
              <input
                data-testid="address-formatted"
                type="text"
                value={formatted}
                placeholder={label('formattedPlaceholder')}
                aria-invalid={Boolean(error)}
                maxLength={512}
                onChange={(event) => { setFormatted(event.target.value); if (error) setError(null); }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') { event.preventDefault(); handleSave(); }
                }}
                className={`w-full rounded border px-2 py-1.5 text-sm bg-[var(--bg-primary)] ${
                  error ? 'border-red-500' : 'border-[var(--border-primary)]'
                }`}
              />
              {error && <span role="alert" className="block text-xs text-red-500">{error}</span>}
            </label>

            <label className="block space-y-1">
              <span className="block text-xs font-medium text-[var(--text-secondary)]">{label('name')}</span>
              <input
                data-testid="address-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') { event.preventDefault(); handleSave(); }
                }}
                className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm"
              />
              <span className="block text-xs text-[var(--text-tertiary)]">{label('nameHint')}</span>
            </label>

            <div className="rounded border border-[var(--border-secondary)]">
              <button
                type="button"
                data-testid="address-components-toggle"
                aria-expanded={componentsOpen}
                onClick={() => setComponentsOpen((open) => !open)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                <span>{label('components')}</span>
                <span aria-hidden="true">{componentsOpen ? '▾' : '▸'}</span>
              </button>
              {componentsOpen && (
                <div className="grid grid-cols-1 gap-2 border-t border-[var(--border-secondary)] p-3 sm:grid-cols-2">
                  {ADDRESS_COMPONENT_KEYS.map((key) => (
                    <label key={key} className="block space-y-1">
                      <span className="block text-xs text-[var(--text-secondary)]">{label(key)}</span>
                      <input
                        data-testid={`address-${key}`}
                        type="text"
                        value={components[key]}
                        maxLength={key === 'country_code' ? 2 : 256}
                        onChange={(event) => setComponents((prev) => ({ ...prev, [key]: event.target.value }))}
                        className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-sm"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-2">
            <div>
              {initial && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {label('clear')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
              >
                {label('cancel')}
              </button>
              <button
                type="button"
                data-testid="address-save"
                onClick={handleSave}
                className="rounded bg-[var(--color-primary-800)] px-3 py-1.5 text-xs text-white"
              >
                {label('save')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
