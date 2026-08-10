/**
 * ChatToolbarOverflowMenu — `⋮` popover at the right edge of the chat
 * toolbar. Stacks rarely-used actions vertically (ADR-0059 §4.1).
 *
 * Items (in order):
 *   1. 🔔 Уведомления      → onNotifications()  (per-chat inline tab)
 *   2. 👥 Участники        → onParticipants()   (per-chat inline tab)
 *   3. 🗑 Удалить чат      → onDelete()         (red)
 *
 * Closes on outside click and on item click.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Trash2, Bell, Users } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface ChatToolbarOverflowMenuProps {
  onDelete?: () => void;
  /** ADR-0064 §Per-chat override surface. Disabled when no conversation is active. */
  onNotifications?: () => void;
  notificationsDisabled?: boolean;
  /** ADR-0064 §Per-chat participants tab in the inline settings panel. */
  onParticipants?: () => void;
  participantsDisabled?: boolean;
  /** When true, the Delete entry is rendered disabled (no current chat). */
  deleteDisabled?: boolean;
}

export function ChatToolbarOverflowMenu({
  onDelete,
  onNotifications,
  notificationsDisabled,
  onParticipants,
  participantsDisabled,
  deleteDisabled,
}: ChatToolbarOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleReflow = () => setOpen(false);
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReflow);
    window.addEventListener('scroll', handleReflow, true);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReflow);
      window.removeEventListener('scroll', handleReflow, true);
    };
  }, [open]);

  const handleItem = (handler?: () => void) => {
    setOpen(false);
    handler?.();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Ещё"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'p-1 rounded transition-colors flex-shrink-0',
          open
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
        )}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: coords.top, right: coords.right, zIndex: 1000 }}
          className="min-w-[180px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-xl py-1"
        >
          {onNotifications && (
            <button
              type="button"
              role="menuitem"
              onClick={() => !notificationsDisabled && handleItem(onNotifications)}
              disabled={notificationsDisabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                notificationsDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-tertiary)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
              )}
            >
              <Bell className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span>Уведомления чата</span>
            </button>
          )}
          {onParticipants && (
            <button
              type="button"
              role="menuitem"
              onClick={() => !participantsDisabled && handleItem(onParticipants)}
              disabled={participantsDisabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                participantsDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-tertiary)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
              )}
            >
              <Users className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span>Участники</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={() => !deleteDisabled && handleItem(onDelete)}
              disabled={deleteDisabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                deleteDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-tertiary)]'
                  : 'text-red-400 hover:bg-red-500/10',
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить чат</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export default ChatToolbarOverflowMenu;
