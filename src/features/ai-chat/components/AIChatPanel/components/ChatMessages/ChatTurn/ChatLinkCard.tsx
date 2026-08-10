/**
 * ChatLinkCard — ADR-0031 §Z / WP-24.
 *
 * Inbox-row-styled card used both for MovedStubBubble (source) and
 * MovedFromBanner (target). Unified with the conversation rows shown in
 * InboxPanel so the user gets the same visual language whether they're
 * skimming the inbox or seeing a moved-message link inside a chat.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  ╭───╮  Перенесено · <mover name> · <when>           │  ← header
 *   ├──────────────────────────────────────────────────────┤
 *   │  ⋄ <Chat title>                                      │  ← tiny inline icon + title
 *   │  🔗 <linked row title> · <table name>                │  ← linked-row chip (if any)
 *   │  #<id> · Группа · 6 уч. · 9 мая    3 сообщ. ▼ Показать │  ← combined meta + totals + toggle
 *   └──────────────────────────────────────────────────────┘
 *
 * - Header: mover avatar + "Перенесено · <name>" (kept from prior layout).
 * - Body section: tiny inline chat-type icon next to the chat title; below it
 *   is the linked-row chip (if any), then a single combined row with chat-id,
 *   type, participants and created-date on the left, and the moved-message
 *   count + inline expand toggle on the right.
 *
 * Click → onClick (host opens the chat). The optional inline toggle on the
 * right of the totals row ("▼ Показать" / "▲ Скрыть") flips `expanded`
 * via `onExpandToggle` — the actual expanded body (moved-message preview)
 * lives OUTSIDE the card, rendered by the parent in the bubble body.
 *
 * Layout note: the toggle button is a flex sibling of the navigate button (NOT
 * absolutely positioned over it) — overlapping hit areas previously caused
 * stray clicks near the toggle to navigate to the linked chat instead.
 *
 * Loading / error states render a gray skeleton or gray "deleted/no
 * access" plate — never a broken card.
 */
import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Inbox,
  Link2,
  MessageCircle,
  User,
  Users,
} from 'lucide-react';
import { useChatSummary, type ChatSummary } from '../../../../../hooks/useChatSummary';

export interface ChatLinkCardMovedBy {
  user_id?: number;
  name?: string | null;
  avatar?: string | null;
}

export interface ChatLinkCardProps {
  conversationId: number;
  direction: 'forward' | 'backward';
  /** Click handler — host opens the chat (and scrolls to firstMessageId). */
  onClick?: (conversationId: number, firstMessageId?: number) => void;
  /** First moved message id for scroll-to-message in the target chat. */
  firstMessageId?: number;
  /** Number of moved messages in this batch (omit / 1 → singular wording). */
  count?: number;
  /** Actor who performed the move (from metadata.moved_by). */
  movedBy?: ChatLinkCardMovedBy;
  /** Show chevron toggle (host renders the expanded preview separately). */
  expandable?: boolean;
  /** Controlled expanded state for the chevron icon. */
  expanded?: boolean;
  /** Toggle callback — host flips `expanded`. */
  onExpandToggle?: () => void;
  /** Color for the left-edge accent stripe (matches the MOVER, not the bubble
   *  owner — host derives a stable per-mover hue from `movedBy`). */
  accentColor?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  group: 'Группа',
  direct: 'Личный чат',
  task: 'Задача',
  inbox: 'Входящие',
  ticket: 'Тикет',
  row: 'Строка',
};

const TypeIconInner: React.FC<{ type?: ChatSummary['type']; className?: string }> = ({ type, className = 'w-3 h-3' }) => {
  switch (type) {
    case 'group':
      return <Users className={className} />;
    case 'direct':
      return <MessageCircle className={className} />;
    case 'task':
    case 'ticket':
    case 'row':
      return <Link2 className={className} />;
    case 'inbox':
      return <Inbox className={className} />;
    default:
      return <MessageCircle className={className} />;
  }
};

const formatChatCreatedAt = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const initialOf = (name?: string | null): string => {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
};

const MoverAvatar: React.FC<{ movedBy?: ChatLinkCardMovedBy }> = ({ movedBy }) => {
  if (movedBy?.avatar) {
    return (
      <img
        src={movedBy.avatar}
        alt=""
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  if (movedBy?.name) {
    return (
      <div className="w-7 h-7 rounded-full bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)] font-semibold text-[11px] flex items-center justify-center flex-shrink-0">
        {initialOf(movedBy.name)}
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
      <User className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
    </div>
  );
};

const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

const formatParticipants = (n: number): string => `${n} уч.`;

const formatMovedCount = (n: number): string => `${n} сообщ.`;

// ─── Subcomponents (gray plates) ──────────────────────────────────────────────

const GrayPlate: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-[var(--bg-tertiary)]/50 border border-[var(--border-secondary)]/40 text-xs text-[var(--text-tertiary)]">
    {children}
  </div>
);

const SkeletonCard: React.FC = () => (
  <div
    data-chatlinkcard-state="loading"
    className="px-3 py-2 rounded-md bg-[var(--bg-tertiary)]/60"
  >
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] flex-shrink-0" />
      <div className="h-3 w-2/3 rounded bg-[var(--bg-secondary)]" />
    </div>
    <div className="h-2.5 w-1/2 rounded bg-[var(--bg-secondary)]/70 mt-1.5" />
    <div className="h-2 w-1/3 rounded bg-[var(--bg-secondary)]/50 mt-1" />
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const ChatLinkCard: React.FC<ChatLinkCardProps> = ({
  conversationId,
  direction,
  onClick,
  firstMessageId,
  count,
  movedBy,
  expandable,
  expanded,
  onExpandToggle,
  accentColor,
}) => {
  const { data, isLoading, error } = useChatSummary(conversationId);

  // Loading skeleton.
  if (isLoading && !data) return <SkeletonCard />;

  // Error: no access.
  if (error && error.kind === 'forbidden') {
    return <GrayPlate>Нет доступа к чату #{conversationId}</GrayPlate>;
  }
  // Error: not found / generic — still render a stable plate.
  if (error) {
    return <GrayPlate>Чат #{conversationId} недоступен</GrayPlate>;
  }
  if (!data) return null;

  // Soft-deleted.
  if (data.deleted) {
    return <GrayPlate>Чат удалён #{conversationId}</GrayPlate>;
  }

  const title = data.title || `Чат #${conversationId}`;
  const moverName = movedBy?.name || null;
  const headerText = moverName
    ? `Перенесено · ${moverName}`
    : 'Перенесено';

  const movedCount = count ?? 1;
  const participantsTotal = data.participants_total || 0;
  const createdAtLabel = formatChatCreatedAt(data.created_at);
  const typeLabel = data.type ? (TYPE_LABEL[data.type] || data.type) : null;

  // Combined meta line: "#<id> · Группа · 6 уч. · 9 мая"
  const metaParts: string[] = [`#${conversationId}`];
  if (typeLabel) metaParts.push(typeLabel);
  if (participantsTotal > 0) metaParts.push(formatParticipants(participantsTotal));
  if (createdAtLabel) metaParts.push(createdAtLabel);
  const metaLine = metaParts.join(' · ');

  const handleNavigate = () => {
    onClick?.(conversationId, firstMessageId);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpandToggle?.();
  };

  const directionWord = direction === 'forward' ? 'в' : 'из';

  return (
    <div
      data-chatlinkcard="true"
      data-direction={direction}
      data-conversation-id={conversationId}
      data-expanded={expanded ? 'true' : 'false'}
      className="relative rounded-md bg-[var(--bg-tertiary)] overflow-hidden"
      style={accentColor ? { boxShadow: `inset 3px 0 0 0 ${accentColor}` } : undefined}
    >
      {/* Header zone: who moved + when (mover avatar + name) */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 min-w-0">
        <MoverAvatar movedBy={movedBy} />
        <div className="text-[12px] font-medium text-[var(--text-secondary)] truncate flex-1 min-w-0">
          {headerText}
        </div>
      </div>

      <div className="border-t border-[var(--border-secondary)]/40" />

      {/* Body zone: title + bound_row chip — clickable to navigate. The bottom
          row (meta/count/toggle) lives OUTSIDE this button so the toggle button
          never overlaps with the navigate hit area. */}
      <button
        type="button"
        onClick={handleNavigate}
        className="w-full text-left px-3 pt-2 pb-1 hover:bg-[var(--bg-secondary)]/40 transition-colors"
        title={`Открыть чат #${conversationId}`}
      >
        {/* Title row: tiny chat-type icon inline with chat title */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[var(--text-tertiary)] flex-shrink-0" aria-hidden="true">
            <TypeIconInner type={data.type} className="w-3 h-3" />
          </span>
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate min-w-0">
            {directionWord} «{title}»
          </span>
        </div>

        {/* Bound row chip (if any) */}
        {data.bound_row && (data.bound_row.title || data.bound_row.row_id) && (
          <div className="text-[10px] text-blue-400 truncate mt-0.5">
            🔗 {data.bound_row.title || `#${data.bound_row.row_id}`}
            {data.bound_row.table_name && (
              <span className="text-[var(--text-tertiary)]"> · {data.bound_row.table_name}</span>
            )}
          </div>
        )}
      </button>

      {/* Footer row: meta on the left (clickable, navigates), then count + toggle
          on the right. Toggle is a flex sibling — no overlap with navigate. */}
      <div className="flex items-baseline justify-between gap-2 px-3 pb-2 min-w-0">
        <button
          type="button"
          onClick={handleNavigate}
          className="text-left text-[10px] text-[var(--text-tertiary)] truncate flex-1 min-w-0 hover:text-[var(--text-secondary)] transition-colors"
          title={`Открыть чат #${conversationId}`}
        >
          {metaLine}
        </button>
        <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-shrink-0">
          {formatMovedCount(movedCount)}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={handleToggleExpand}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]/70 hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
            title={expanded ? 'Свернуть сообщения' : 'Показать сообщения'}
            aria-label={expanded ? 'Свернуть сообщения' : 'Показать сообщения'}
            aria-expanded={expanded}
          >
            {expanded
              ? <><ChevronUp className="w-3 h-3" /> <span>Скрыть</span></>
              : <><ChevronDown className="w-3 h-3" /> <span>Показать</span></>}
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatLinkCard;
