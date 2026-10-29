import { useMemo, useState } from 'react';
import {
  Forward,
  Archive,
  ArchiveRestore,
  Trash2,
  Star,
  Paperclip,
  Reply,
  MessageCirclePlus,
  FolderInput,
  Folder,
  ChevronDown,
} from 'lucide-react';
import { DropdownMenu } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { isOutgoingFolder, type MailFolder, type MailFolderId, type MailMessage } from '../types';
import { messageType, type MailSettings } from '../settings';
import { rowTintFromHex } from '../utils/labelColor';
import { bodySnippet, cleanPreview } from '../utils/preview';
import { baseSubject } from '../utils/quote';
import { MailLabelChips } from './MailLabelChips';
import { MailRowAttachments, useMailAttachmentDialogs } from './MailAttachmentChips';
import { folderLabel } from './MailFolderRail';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MailListProps {
  messages: MailMessage[];
  /** Space the mailbox belongs to — needed for attachment bytes URLs. */
  spaceId: number | undefined;
  selectedId: string | null;
  /** Width (px) of the left meta column — driven by the full-height divider. */
  listWidth: number;
  onSelect: (id: string) => void;
  /** Per-row quick action — open this message and seed the composer to forward it. */
  onForward: (message: MailMessage) => void;
  /** Flag/bookmark toggle + folder moves. `onArchive` toggles archive ⇄ inbox. */
  onStar: (message: MailMessage) => void;
  onArchive: (message: MailMessage) => void;
  onDelete: (message: MailMessage) => void;
  /** Attach this mail row to the chat message being composed (ADR-158 §P5 chip). */
  onAttachToMessage: (message: MailMessage) => void;
  /** Folder list for the per-row "В папку" menu + the move itself. */
  folders: MailFolder[];
  onMoveToFolder: (message: MailMessage, folderId: MailFolderId) => void;
  /** Batch-selection set + toggle (checkbox column). */
  checkedIds: Set<string>;
  onToggleChecked: (id: string) => void;
  /** Client-side view/interaction prefs (hover actions, snippets, type indicators, threads). */
  settings: MailSettings;
  /** Label ids whose colour tints the rows carrying them (Settings → Ярлыки). */
  colorizeIds: Set<number>;
}

// Gmail-style relative stamp: today → time, this calendar year → "Mon D",
// older → numeric date. Keeps the date column narrow while staying unambiguous.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/**
 * Thread key — the server keeps no References/In-Reply-To headers, so threads
 * are derived: same subject (Re:/Fwd: stripped) with the same counterpart
 * (sender for incoming, first recipient for outgoing). A reply to our mail and
 * our reply to theirs land in one thread; "(no subject)" never merges across people.
 */
function threadKey(m: MailMessage): string {
  const subject = baseSubject(m.subject || '').toLowerCase() || '(no subject)';
  const counterpart = (isOutgoingFolder(m.folder) ? m.to?.[0] : m.fromAddress) ?? '';
  return `${subject}|${counterpart.toLowerCase()}`;
}

interface Thread {
  head: MailMessage;
  rest: MailMessage[];
}

/** Newest-first input → the first message seen per key heads its thread. */
function groupThreads(messages: MailMessage[], enabled: boolean): Thread[] {
  if (!enabled) return messages.map((m) => ({ head: m, rest: [] }));
  const byKey = new Map<string, Thread>();
  for (const m of messages) {
    const key = threadKey(m);
    const thread = byKey.get(key);
    if (thread) thread.rest.push(m);
    else byKey.set(key, { head: m, rest: [] });
  }
  return [...byKey.values()];
}

export function MailList({
  messages,
  spaceId,
  selectedId,
  listWidth,
  onSelect,
  onForward,
  onStar,
  onArchive,
  onDelete,
  onAttachToMessage,
  folders,
  onMoveToFolder,
  checkedIds,
  onToggleChecked,
  settings,
  colorizeIds,
}: MailListProps) {
  // One all-files modal + one image viewer for the whole list.
  const { openAll, openImage, dialogs } = useMailAttachmentDialogs(spaceId);
  const { t } = useLanguage();
  // Threads expanded by the user (keyed by the head message id).
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  const threads = useMemo(() => groupThreads(messages, settings.threads), [messages, settings.threads]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
        {t('mail.list.empty')}
      </div>
    );
  }

  const toggleThread = (id: string) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const rowProps = {
    spaceId,
    listWidth,
    settings,
    colorizeIds,
    folders,
    onSelect,
    onForward,
    onStar,
    onArchive,
    onDelete,
    onAttachToMessage,
    onMoveToFolder,
    onToggleChecked,
    onOpenImage: openImage,
    onOpenAll: openAll,
  };

  return (
    <>
      <ul className="flex flex-col divide-y divide-[var(--border-primary)]">
        {threads.flatMap(({ head, rest }) => {
          // A thread stays open while the reader shows one of its inner messages.
          const open = rest.length > 0 && (openThreads.has(head.id) || rest.some((m) => m.id === selectedId));
          const rows = [
            <MailRow
              key={head.id}
              message={head}
              active={head.id === selectedId}
              checked={checkedIds.has(head.id)}
              thread={rest.length ? { count: rest.length + 1, open, toggle: () => toggleThread(head.id) } : null}
              {...rowProps}
            />,
          ];
          if (open) {
            rows.push(
              ...rest.map((m) => (
                <MailRow
                  key={m.id}
                  message={m}
                  active={m.id === selectedId}
                  checked={checkedIds.has(m.id)}
                  thread={null}
                  nested
                  {...rowProps}
                />
              ))
            );
          }
          return rows;
        })}
      </ul>
      {dialogs}
    </>
  );
}

interface MailRowProps {
  message: MailMessage;
  active: boolean;
  checked: boolean;
  /** Head of a multi-message thread: count badge + expand toggle. */
  thread: { count: number; open: boolean; toggle: () => void } | null;
  /** Inner thread message — indented under its head. */
  nested?: boolean;
  spaceId: number | undefined;
  listWidth: number;
  settings: MailSettings;
  colorizeIds: Set<number>;
  folders: MailFolder[];
  onSelect: (id: string) => void;
  onForward: (message: MailMessage) => void;
  onStar: (message: MailMessage) => void;
  onArchive: (message: MailMessage) => void;
  onDelete: (message: MailMessage) => void;
  onAttachToMessage: (message: MailMessage) => void;
  onMoveToFolder: (message: MailMessage, folderId: MailFolderId) => void;
  onToggleChecked: (id: string) => void;
  onOpenImage: (message: MailMessage, index: number) => void;
  onOpenAll: (message: MailMessage) => void;
}

const ACTION_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]';

function MailRow({
  message,
  active,
  checked,
  thread,
  nested = false,
  spaceId,
  listWidth,
  settings,
  colorizeIds,
  folders,
  onSelect,
  onForward,
  onStar,
  onArchive,
  onDelete,
  onAttachToMessage,
  onMoveToFolder,
  onToggleChecked,
  onOpenImage,
  onOpenAll,
}: MailRowProps) {
  const { t } = useLanguage();
  // Outgoing folders: the row's meaningful contact is the recipient, not
  // our own mailbox (fromName). Guard against a not-yet-populated `to`.
  const outgoing = isOutgoingFolder(message.folder);
  const recipients = message.to?.filter(Boolean) ?? [];
  const name = outgoing
    ? recipients.length > 0
      ? t('mail.list.toPrefix', { list: recipients.join(', ') })
      : t('mail.common.noRecipient')
    : message.fromName || message.fromAddress;
  // Line-3 address: recipient for outgoing, sender address for incoming.
  const email = outgoing ? recipients.join(', ') : message.fromAddress;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const archived = message.folder === 'archive';
  const type = messageType(message.folder);
  // Row snippet: the full body (when the list row carries it) gives the three
  // clamped lines something to fill; the stored 140-char preview is the fallback.
  const snippet = useMemo(
    () => bodySnippet(message.body) || cleanPreview(message.preview),
    [message.body, message.preview]
  );

  // Type indicator (ADR-158): a coloured stripe down the row's left edge.
  // Row tint: the first label on this row that opted into "colorize" fills the
  // row with a faint version of its colour — skipped when the row already
  // carries an active/checked bg.
  const tintLabel = message.labels?.find((l) => l.color && colorizeIds.has(l.id));
  const tint = tintLabel?.color ? rowTintFromHex(tintLabel.color) : undefined;
  const rowStyle: React.CSSProperties = {};
  if (settings.typeIndicators) {
    rowStyle.boxShadow = `inset 3px 0 0 0 ${settings.typeColors[type]}`;
  }
  if (tint && !active && !checked) rowStyle.backgroundColor = tint;

  // "В папку" — every folder except the one the row is already in.
  const folderItems = folders
    .filter((f) => f.id !== message.folder)
    .map((f) => ({
      label: folderLabel(f, t),
      value: String(f.id),
      icon: <Folder size={14} />,
      onSelect: () => onMoveToFolder(message, f.id),
    }));

  return (
    <li
      style={rowStyle}
      className={cn(
        'group relative flex min-h-[84px] items-stretch transition-colors',
        active
          ? 'bg-[var(--bg-tertiary)]'
          : checked
            ? 'bg-[var(--bg-secondary)]'
            : 'hover:bg-[var(--bg-secondary)]'
      )}
    >
      {/* Thread guide — inner messages hang off a thin line under the head. */}
      {nested && <span aria-hidden="true" className="absolute bottom-0 left-5 top-0 w-px bg-[var(--border-primary)]" />}

      {/* LEFT — the message-list column: checkbox + a 3-line stack
          (sender+date / subject / email+actions). On phones it takes the
          full row (single-column list); from md its width tracks the
          full-height divider so the reading pane aligns to the same edge. */}
      <div
        className={cn(
          'flex w-full flex-shrink-0 items-start gap-2 py-2 pr-2 md:w-[var(--meta-w)]',
          nested ? 'pl-8' : 'pl-3'
        )}
        style={{ '--meta-w': `${listWidth}px` } as React.CSSProperties}
      >
        {/* Checkbox column: the type indicator is the coloured left stripe on
            the row (see rowStyle); "Отвечено" sits under the box. */}
        <div className="flex flex-shrink-0 flex-col items-center gap-1.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleChecked(message.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('mail.list.selectMessage', { name })}
            className="mt-1 h-4 w-4 cursor-pointer accent-[var(--accent-primary)]"
          />
          {settings.typeIndicators && <span className="sr-only">{t(`mail.types.${type}`)}</span>}
          {message.repliedAt && (
            <span title={t('mail.list.replied')} className="leading-none text-[var(--text-tertiary)]">
              <Reply size={12} aria-label={t('mail.list.replied')} />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Line 1 — sender name + date. */}
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(message.id)}
            className="flex min-h-8 w-full items-baseline gap-2 text-left md:min-h-0"
          >
            <span
              className={cn(
                'h-2 w-2 flex-shrink-0 rounded-full',
                message.read ? 'bg-transparent' : 'bg-[var(--color-primary-600)]'
              )}
              aria-label={message.read ? undefined : t('mail.list.unread')}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                message.read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
              )}
            >
              {name}
            </span>
            {hasAttachments && (
              <Paperclip size={12} className="flex-shrink-0 text-[var(--text-tertiary)]" aria-label={t('mail.list.hasAttachments')} />
            )}
            <time className="flex-shrink-0 text-xs text-[var(--text-tertiary)]">{formatDate(message.date)}</time>
          </button>

          {/* Line 2 — subject + labels + thread count. Unread emphasis lives
              on the subject, not the sender (owner request, 2026-10-17). Chips sit right of the
              subject (ADR-158 §P4); 2+ labels wrap to a second line, still
              right-aligned; renders nothing when unlabeled. The thread toggle
              is the outermost element so it always hugs the right edge. */}
          <div className="flex items-start gap-2 pl-4">
            <button
              type="button"
              onClick={() => onSelect(message.id)}
              className={cn(
                'min-h-8 min-w-0 flex-1 truncate text-left text-xs md:min-h-0',
                message.read ? 'text-[var(--text-tertiary)]' : 'font-semibold text-[var(--text-primary)]'
              )}
            >
              {message.subject || t('mail.common.noSubject')}
            </button>
            <MailLabelChips labels={message.labels} className="max-w-[55%] flex-shrink-0 justify-end" />
            {thread && (
              <button
                type="button"
                aria-expanded={thread.open}
                aria-label={thread.open ? t('mail.list.collapseThread') : t('mail.list.expandThread', { count: thread.count })}
                title={thread.open ? t('mail.list.collapseThread') : t('mail.list.expandThread', { count: thread.count })}
                onClick={(e) => {
                  e.stopPropagation();
                  thread.toggle();
                }}
                className="flex flex-shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-primary)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--text-secondary)] transition-colors hover:border-[var(--color-primary-500)] hover:text-[var(--text-primary)]"
              >
                {thread.count}
                <ChevronDown size={10} className={cn('transition-transform', thread.open && 'rotate-180')} />
              </button>
            )}
          </div>

          {/* Line 3 — email address + per-row action buttons (hover/focus). */}
          <div className="flex items-center gap-1 pl-4">
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-tertiary)]">{email || '—'}</span>
            {settings.hoverActions && (
              <div className="hidden flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:flex">
                <RowAction label={t('mail.list.forward')} onClick={() => onForward(message)}>
                  <Forward size={14} />
                </RowAction>
                <RowAction label={t('mail.common.delete')} onClick={() => onDelete(message)}>
                  <Trash2 size={14} />
                </RowAction>
                <RowAction label={archived ? t('mail.list.unarchive') : t('mail.list.archive')} onClick={() => onArchive(message)}>
                  {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                </RowAction>
                <RowAction
                  label={message.starred ? t('mail.list.unstar') : t('mail.list.star')}
                  active={message.starred}
                  onClick={() => onStar(message)}
                >
                  <Star size={14} className={message.starred ? 'fill-current' : undefined} />
                </RowAction>
                {/* Move to any folder (system or user). The Radix trigger is the
                    button itself (asChild); stopPropagation keeps the row from
                    opening underneath. */}
                {folderItems.length > 0 && (
                  <DropdownMenu
                    align="end"
                    items={folderItems}
                    trigger={
                      <button
                        type="button"
                        aria-label={t('mail.list.moveToFolder')}
                        title={t('mail.list.moveToFolder')}
                        onClick={(e) => e.stopPropagation()}
                        className={ACTION_CLASS}
                      >
                        <FolderInput size={14} />
                      </button>
                    }
                  />
                )}
                {/* Attach this mail row to the chat message being written — same
                    action as "Прикрепить к сообщению" on a table row. */}
                <RowAction label={t('mail.list.attachToChat')} onClick={() => onAttachToMessage(message)}>
                  <MessageCirclePlus size={14} />
                </RowAction>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT — body preview glued to the row + attachment chips filling in from
          the right edge. On open this whole column is covered by the reading
          pane. Hidden on phones (single-column list). */}
      <div className="hidden min-w-0 flex-1 items-start gap-3 px-4 py-2 md:flex">
        <button
          type="button"
          onClick={() => onSelect(message.id)}
          className="min-h-8 min-w-0 flex-1 self-stretch text-left"
        >
          {settings.showSnippets && (
            <span className="line-clamp-3 text-xs leading-5 text-[var(--text-tertiary)]">
              {snippet || <span className="italic opacity-70">{t('mail.list.noPreview')}</span>}
            </span>
          )}
        </button>
        <MailRowAttachments spaceId={spaceId} message={message} onOpenImage={onOpenImage} onOpenAll={onOpenAll} />
      </div>
    </li>
  );
}

function RowAction({
  label,
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      disabled={disabled}
      onClick={(e) => {
        // Never let a row action bubble up into the row's open-message click.
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        disabled
          ? 'cursor-not-allowed text-[var(--text-tertiary)] opacity-40'
          : active
            ? 'text-[var(--color-warning,#eab308)] hover:bg-[var(--bg-secondary)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
      )}
    >
      {children}
    </button>
  );
}
