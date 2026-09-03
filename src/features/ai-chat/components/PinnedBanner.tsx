/**
 * ADR-0068 WP-E — Pinned-messages panel.
 *
 * The old collapsed "N закреплённых ▾" strip is gone: the pinned count now
 * lives solely on the toolbar Pin badge (ChatToolbar). This component only
 * renders the pinned list, and only while `open` (driven by that toolbar
 * button). Each row is a flat, notification-style card — accent left border,
 * sender + preview, inline ✕ unpin — deliberately WITHOUT rounded corners.
 *
 * Accepts a generic `PinnedBannerItem` shape so both the new canvas
 * (ChatMessageItem) and the production AIChatPanel canvas (ChatMessage) can
 * feed it without coupling to either type. Cap soft-warns at 50.
 */

import { useMemo, useState } from 'react';
import { Pin, X } from 'lucide-react';

export interface PinnedBannerItem {
  id: number | string;
  content: string;
  pinned_at?: string | null;
  is_deleted?: boolean;
  /** Display label for the sender of the pinned message (e.g. "Вы", agent name). */
  senderLabel?: string;
}

export interface PinnedBannerProps {
  messages: PinnedBannerItem[];
  onJump: (messageId: number | string) => void;
  onUnpin?: (messageId: number | string) => void;
  capReached?: boolean;
  onClearCapNotice?: () => void;
  /**
   * Controlled expanded state. When provided together with `onOpenChange`,
   * the host owns the open/closed flag (e.g. AIChatPanel toolbar button).
   * When omitted, the banner falls back to internal uncontrolled state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PIN_CAP = 50;

export function PinnedBanner({ messages, onJump, onUnpin, capReached, onClearCapNotice, open: openProp, onOpenChange }: PinnedBannerProps) {
  const [openInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : openInternal;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
  };

  const pinned = useMemo(() => {
    return messages
      .filter((m) => !!m.pinned_at && !m.is_deleted)
      .sort((a, b) => new Date(b.pinned_at as string).getTime() - new Date(a.pinned_at as string).getTime());
  }, [messages]);

  // Nothing to surface: no open list and no cap warning.
  if (!capReached && (!open || pinned.length === 0)) return null;

  return (
    <div className="flex-shrink-0 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
      {capReached && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-100/40 dark:bg-amber-900/20 border-b border-amber-200/40 dark:border-amber-800/40">
          <span className="flex-1">Лимит закреплённых — {PIN_CAP}. Открепите что-то и попробуйте снова.</span>
          {onClearCapNotice && (
            <button
              type="button"
              onClick={onClearCapNotice}
              className="p-0.5 hover:bg-amber-200/40 dark:hover:bg-amber-800/40"
              aria-label="Скрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {open && pinned.length > 0 && (
        <ul className="max-h-[40vh] overflow-y-auto flex flex-col gap-1 p-1.5">
          {pinned.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-2.5 px-3 py-2 bg-[var(--bg-secondary)] border-l-2 border-[var(--color-primary-500)] hover:bg-[var(--bg-primary)] transition-colors"
            >
              <Pin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--color-primary-500)]" />
              <button
                type="button"
                onClick={() => { onJump(m.id); setOpen(false); }}
                className="flex-1 min-w-0 text-left"
              >
                <div className="text-[11px] font-semibold text-[var(--color-primary-500)] truncate">
                  {m.senderLabel || 'Сообщение'}
                </div>
                <div className="text-xs text-[var(--text-primary)] line-clamp-2 break-words mt-0.5">
                  {m.content.slice(0, 180)}
                </div>
              </button>
              {onUnpin && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onUnpin(m.id); }}
                  className="flex-shrink-0 p-1 text-[var(--text-tertiary)] hover:text-red-500 hover:bg-[var(--bg-tertiary)]"
                  title="Открепить"
                  aria-label="Открепить"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
