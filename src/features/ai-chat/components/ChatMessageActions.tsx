/**
 * Per-message inline action UI extracted from ChatMessageList.
 *
 * - ChatMessageContextMenu: right-click dropdown (Reply/Quote/Copy/Forward/Edit/Delete)
 * - ChatQuoteConfirmStrip: in-bubble strip shown while user selects text to quote
 */

import { Reply, Quote, Copy, Forward, Edit3, Trash2, Pin, PinOff } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { ChatMessageItem } from './ChatConversationView';
import type { ChatMessageItemTurn } from '../utils/groupChatMessageItems';

export interface ChatMessageContextMenuProps {
  message: ChatMessageItem;
  turn: ChatMessageItemTurn;
  isOwn: boolean;
  onReply: (message: ChatMessageItem) => void;
  onQuote: (message: ChatMessageItem) => void;
  onForward?: (message: ChatMessageItem) => void;
  onEdit?: (messageId: number | string, newContent: string) => void;
  onDelete?: (messageId: number | string) => void;
  // ADR-0068 WP-E — present when pin is permitted for the active user in this
  // conversation. Absent → menu omits Pin/Unpin entirely (e.g. read-only).
  onPin?: (messageId: number | string) => void;
  onUnpin?: (messageId: number | string) => void;
  onClose: () => void;
}

export function ChatMessageContextMenu({
  message,
  turn,
  isOwn,
  onReply,
  onQuote,
  onForward,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onClose,
}: ChatMessageContextMenuProps) {
  const isPinned = !!message.pinned_at;
  return (
    <div
      className={cn(
        'absolute z-10 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[140px]',
        isOwn ? 'right-0 top-full mt-1' : 'left-0 top-full mt-1',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onReply(message); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      >
        <Reply className="w-4 h-4" /> Ответить
      </button>
      <button
        onClick={() => { onQuote(message); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      >
        <Quote className="w-4 h-4" /> Цитировать
      </button>
      <button
        onClick={() => { navigator.clipboard.writeText(message.content); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      >
        <Copy className="w-4 h-4" /> Копировать
      </button>
      {onForward && (
        <button
          onClick={() => { turn.messages.forEach((m) => onForward(m)); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          <Forward className="w-4 h-4" /> Переслать{turn.messages.length > 1 ? ` (${turn.messages.length})` : ''}
        </button>
      )}
      {isPinned && onUnpin && (
        <button
          onClick={() => { onUnpin(message.id); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          <PinOff className="w-4 h-4" /> Открепить
        </button>
      )}
      {!isPinned && onPin && (
        <button
          onClick={() => { onPin(message.id); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          <Pin className="w-4 h-4" /> Закрепить
        </button>
      )}
      {isOwn && onEdit && (
        <button
          onClick={onClose}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          <Edit3 className="w-4 h-4" /> Изменить
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => { onDelete(message.id); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-[var(--bg-tertiary)]"
        >
          <Trash2 className="w-4 h-4" /> Удалить
        </button>
      )}
    </div>
  );
}

export interface ChatQuoteConfirmStripProps {
  isOwn: boolean;
  fragment: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChatQuoteConfirmStrip({
  isOwn,
  fragment,
  onConfirm,
  onCancel,
}: ChatQuoteConfirmStripProps) {
  const trimmed = fragment.trim();
  return (
    <div
      className={cn(
        'mt-1.5 flex items-center gap-1 text-[10px] -mx-1 px-1.5 py-1 rounded',
        isOwn ? 'bg-white/15' : 'bg-[var(--bg-tertiary)]',
      )}
    >
      <Quote className="w-3 h-3 opacity-70" />
      <span className="opacity-80 truncate flex-1 italic" title={fragment}>
        {trimmed ? `«${fragment.slice(0, 60)}»` : 'Выделите фрагмент…'}
      </span>
      <button
        type="button"
        disabled={!trimmed}
        onClick={(e) => { e.stopPropagation(); onConfirm(); }}
        className="px-1.5 py-0.5 rounded bg-[var(--color-primary-500)] text-white disabled:opacity-40"
      >
        OK
      </button>
      <button
        type="button"
        aria-label="Отмена"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="px-1 py-0.5 rounded hover:bg-black/10"
      >
        ✕
      </button>
    </div>
  );
}
