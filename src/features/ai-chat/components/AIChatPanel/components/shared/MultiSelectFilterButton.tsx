/**
 * MultiSelectFilterButton — compact popover-style multi-select used by the
 * tickets/documents/attach-row picker filter strip. Replaces the previous
 * inline chip-grid layout (every option as a chip) with a single button that
 * shows the column label + selected count, and opens a popover containing a
 * search input and a checkbox list of options.
 *
 * Behaviour:
 *   - Click button → opens popover anchored to it.
 *   - Search filters the visible options in-place.
 *   - Clicking an option toggles it.
 *   - "Сбросить" clears all selected values for this column.
 *   - The button face shows: label · (n) when something is selected,
 *     plain label when empty.
 *   - Active selection adds a coloured ring/background so it's obvious at a
 *     glance which filters are active.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';

export interface MultiSelectFilterOption {
  value: string;
  label: string;
  color?: string;
}

interface MultiSelectFilterButtonProps {
  label: string;
  options: MultiSelectFilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function MultiSelectFilterButton({ label, options, value, onChange }: MultiSelectFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
    };
    update();
    const onScroll = () => update();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const s = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(s));
  }, [options, search]);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };

  const active = value.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        title={label}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors min-w-0 max-w-[140px]',
          active
            ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-300)] border-[var(--color-primary-500)]/40'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-secondary)] hover:border-[var(--color-primary-500)]/30'
        )}
      >
        <span className="truncate">{label}</span>
        {active && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary-500)] text-white text-[9px] font-semibold flex-shrink-0">
            {value.length}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--border-secondary)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="py-3 text-center text-[10px] text-[var(--text-tertiary)]">Не найдено</div>
            ) : filtered.map(opt => {
              const sel = value.includes(opt.value);
              const safe = opt.color && /^#?[0-9a-f]{3,8}$/i.test(opt.color)
                ? (opt.color.startsWith('#') ? opt.color : `#${opt.color}`)
                : undefined;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-[var(--bg-tertiary)] transition-colors',
                    sel && 'bg-[var(--color-primary-500)]/10'
                  )}
                >
                  <span
                    className={cn(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                      sel
                        ? 'bg-[var(--color-primary-500)] border-[var(--color-primary-500)] text-white'
                        : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                    )}
                  >
                    {sel && <Check className="w-2.5 h-2.5" />}
                  </span>
                  {safe && (
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: safe }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-[var(--text-primary)] flex-1 min-w-0">{opt.label}</span>
                </button>
              );
            })}
          </div>
          {active && (
            <div className="p-1 border-t border-[var(--border-secondary)]">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors rounded"
              >
                <X className="w-3 h-3" /> Сбросить
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
