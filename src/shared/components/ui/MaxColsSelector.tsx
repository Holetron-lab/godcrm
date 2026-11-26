// The "Max cols" control of the workspaces page, shared with the module catalog (owner, chat 3813,
// 11.11.2026): a row of column counts, the chosen one kept in localStorage, and the page width that
// follows it so a grid never shows more columns than chosen.
import { useState } from 'react';
import { Columns } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export const MAX_COLS_OPTIONS = [4, 5, 6, 7, 8] as const;
export type MaxCols = (typeof MAX_COLS_OPTIONS)[number];
const GAP_PX = 16;

const isMaxCols = (value: number): value is MaxCols => (MAX_COLS_OPTIONS as readonly number[]).includes(value);

const load = (key: string, fallback: MaxCols): MaxCols => {
  try {
    const stored = Number.parseInt(localStorage.getItem(key) ?? '', 10);
    return isMaxCols(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

/** The chosen column count under `key`, kept across visits when the browser lets us. */
export function useMaxCols(key: string, fallback: MaxCols = 6): [MaxCols, (next: MaxCols) => void] {
  const [maxCols, setMaxCols] = useState<MaxCols>(() => load(key, fallback));
  const choose = (next: MaxCols) => {
    setMaxCols(next);
    try { localStorage.setItem(key, String(next)); } catch { /* The choice lives in state when storage is unavailable. */ }
  };
  return [maxCols, choose];
}

/** Width of a page whose grid shows at most `maxCols` slots of `slotPx` each, gaps included. */
export const maxColsWidth = (maxCols: number, slotPx: number) => maxCols * slotPx + (maxCols - 1) * GAP_PX;

export function MaxColsSelector({ value, onChange }: { value: MaxCols; onChange: (next: MaxCols) => void }) {
  const { t } = useLanguage();
  const label = t('spaces.toolbar.maxCols');
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
      <Columns className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">{label}:</span>
      <div className="flex items-center gap-0.5">
        {MAX_COLS_OPTIONS.map(count => (
          <button key={count} type="button" aria-pressed={value === count} onClick={() => onChange(count)}
            className={`min-w-[24px] rounded px-1.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] ${
              value === count ? 'bg-[var(--color-primary-500)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}>
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}
