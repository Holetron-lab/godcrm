import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { SpaceModel } from '@/features/spaces/types/space.types';

export interface SpaceListPopoverProps {
  spaces: SpaceModel[];
  activeSpaceId: number | null;
  onSelect: (spaceId: number) => void;
}

/**
 * SpaceListPopover (ADR-176) — flat, single-level space switcher for the embed
 * header. Unlike the sidebar's nested space→project→table tree, this is a plain
 * list: pick a space, the embedded chat re-keys to that space's contour.
 */
export function SpaceListPopover({ spaces, activeSpaceId, onSelect }: SpaceListPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = spaces.find((s) => s.id === activeSpaceId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 min-w-0 max-w-full rounded-lg px-2 py-1 text-sm hover:bg-[var(--bg-tertiary)] transition-colors"
        title={active?.name ?? 'Select space'}
      >
        <span className="flex-shrink-0 text-base leading-none">{active?.icon || '🗂️'}</span>
        <span className="truncate font-medium text-[var(--text-primary)]">
          {active?.name ?? 'Select space'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Spaces"
          className="absolute left-0 top-full mt-1 z-50 max-h-[60vh] w-64 max-w-[80vw] overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
        >
          {spaces.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--text-tertiary)]">No spaces available</li>
          )}
          {spaces.map((s) => {
            const selected = s.id === activeSpaceId;
            return (
              <li key={s.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(s.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-tertiary)] ${
                    selected ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex-shrink-0 text-base leading-none">{s.icon || '🗂️'}</span>
                  <span className="truncate flex-1">{s.name}</span>
                  {selected && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
