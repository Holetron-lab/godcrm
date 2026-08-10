/**
 * ParticipantsDropdown — popover listing call participants with speaking
 * indicators. ADR-0059 §4.5.
 */

import { useEffect, useRef } from 'react';
import { MicOff, Volume2, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { CallParticipant } from './callStore';

export interface ParticipantsDropdownProps {
  open: boolean;
  participants: CallParticipant[];
  onClose: () => void;
  /** Anchor element rect — popover is positioned underneath it. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function ParticipantsDropdown({ open, participants, onClose, anchorRef }: ParticipantsDropdownProps) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  // Local user first, then alphabetical
  const sorted = [...participants].sort((a, b) => {
    if (a.isLocal && !b.isLocal) return -1;
    if (!a.isLocal && b.isLocal) return 1;
    return a.name.localeCompare(b.name, 'ru');
  });

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Участники звонка"
      className="absolute top-full left-0 mt-1 z-50 w-[240px] max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-xl py-1"
    >
      {sorted.length === 0 || (sorted.length === 1 && sorted[0].isLocal) ? (
        <div className="px-3 py-3 text-xs text-[var(--text-tertiary)] italic">
          Никого больше
        </div>
      ) : null}
      {sorted.map((p) => (
        <div
          key={p.identity}
          className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-[var(--color-primary-500)]/15 flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--text-primary)] truncate">
              {p.name}
              {p.isLocal && (
                <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">(вы)</span>
              )}
            </div>
          </div>
          {p.isSpeaking && (
            <span
              className={cn(
                'inline-flex items-center justify-center w-4 h-4',
                'animate-pulse',
              )}
              aria-label="Говорит"
              title="Говорит"
            >
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            </span>
          )}
          {p.isMuted && (
            <span aria-label="Микрофон выключен" title="Микрофон выключен">
              <MicOff className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
