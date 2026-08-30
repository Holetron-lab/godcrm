import { Forward, Archive, ArchiveRestore, Trash2, Star, Link2, Paperclip } from 'lucide-react';
import { MailLinkPopover } from './MailLinkPopover';
import { cn } from '@/shared/utils/cn';
import { isOutgoingFolder, type MailMessage } from '../types';
import { MAIL_TYPE_LABELS, messageType, type MailSettings } from '../settings';
import { rowTintFromHex } from '../utils/labelColor';
import { cleanPreview } from '../utils/preview';
import { MailLabelChips } from './MailLabelChips';

interface MailListProps {
  messages: MailMessage[];
  /** Space the mailbox belongs to — needed by the per-row "attach to record" picker. */
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
  /** Batch-selection set + toggle (checkbox column). */
  checkedIds: Set<string>;
  onToggleChecked: (id: string) => void;
  /** Client-side view/interaction prefs (hover actions, snippets, type indicators). */
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
  checkedIds,
  onToggleChecked,
  settings,
  colorizeIds,
}: MailListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
        No messages in this folder
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col divide-y divide-[var(--border-primary)]">
      {messages.map((message) => {
        const active = message.id === selectedId;
        const checked = checkedIds.has(message.id);
        // Outgoing folders: the row's meaningful contact is the recipient, not
        // our own mailbox (fromName). Guard against a not-yet-populated `to`.
        const outgoing = isOutgoingFolder(message.folder);
        const recipients = message.to?.filter(Boolean) ?? [];
        const name = outgoing
          ? recipients.length > 0
            ? `To: ${recipients.join(', ')}`
            : 'No recipient'
          : message.fromName || message.fromAddress;
        // Line-3 address: recipient for outgoing, sender address for incoming.
        const email = outgoing ? recipients.join(', ') : message.fromAddress;
        const hasAttachments = (message.attachments?.length ?? 0) > 0;
        const archived = message.folder === 'archive';
        const type = messageType(message.folder);

        // Type indicator (ADR-158): a coloured stripe down the row's left edge
        // (was a dot under the checkbox). Row tint: the first label on this row
        // that opted into "colorize" fills the row with a faint version of its
        // colour — skipped when the row already carries an active/checked bg.
        const tintLabel = message.labels?.find((l) => l.color && colorizeIds.has(l.id));
        const tint = tintLabel?.color ? rowTintFromHex(tintLabel.color) : undefined;
        const rowStyle: React.CSSProperties = {};
        if (settings.typeIndicators) {
          rowStyle.boxShadow = `inset 3px 0 0 0 ${settings.typeColors[type]}`;
        }
        if (tint && !active && !checked) rowStyle.backgroundColor = tint;

        return (
          <li
            key={message.id}
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
            {/* LEFT — the message-list column: checkbox + a 3-line stack
                (sender+date / subject / email+actions). On phones it takes the
                full row (single-column list); from md its width tracks the
                full-height divider so the reading pane aligns to the same edge. */}
            <div
              className="flex w-full flex-shrink-0 items-start gap-2 py-2 pl-3 pr-2 md:w-[var(--meta-w)]"
              style={{ '--meta-w': `${listWidth}px` } as React.CSSProperties}
            >
              {/* Checkbox — the type indicator is now the coloured left stripe on
                  the row (see rowStyle); an sr-only label keeps it announced. */}
              <div className="flex flex-shrink-0 flex-col items-center gap-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleChecked(message.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select message from ${name}`}
                  className="mt-1 h-4 w-4 cursor-pointer accent-[var(--accent-primary)]"
                />
                {settings.typeIndicators && (
                  <span className="sr-only">{MAIL_TYPE_LABELS[type]}</span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Line 1 — sender name + date. */}
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(message.id)}
                  className="flex w-full items-baseline gap-2 text-left"
                >
                  <span
                    className={cn(
                      'h-2 w-2 flex-shrink-0 rounded-full',
                      message.read ? 'bg-transparent' : 'bg-[var(--color-primary-600)]'
                    )}
                    aria-label={message.read ? undefined : 'Unread'}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      message.read
                        ? 'text-[var(--text-secondary)]'
                        : 'font-semibold text-[var(--text-primary)]'
                    )}
                  >
                    {name}
                  </span>
                  {hasAttachments && (
                    <Paperclip
                      size={12}
                      className="flex-shrink-0 text-[var(--text-tertiary)]"
                      aria-label="Has attachments"
                    />
                  )}
                  <time className="flex-shrink-0 text-xs text-[var(--text-tertiary)]">
                    {formatDate(message.date)}
                  </time>
                </button>

                {/* Line 2 — subject + labels. Chips sit at the right edge of the
                    subject row (ADR-158 §P4); 2+ labels wrap to a second line,
                    still right-aligned. Renders nothing when unlabeled. */}
                <div className="flex items-start gap-2 pl-4">
                  <button
                    type="button"
                    onClick={() => onSelect(message.id)}
                    className={cn(
                      'min-w-0 flex-1 truncate text-left text-xs',
                      message.read ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {message.subject || '(no subject)'}
                  </button>
                  <MailLabelChips
                    labels={message.labels}
                    className="max-w-[55%] flex-shrink-0 justify-end"
                  />
                </div>

                {/* Line 3 — email address + per-row action buttons (hover/focus). */}
                <div className="flex items-center gap-1 pl-4">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-tertiary)]">
                    {email || '—'}
                  </span>
                  {settings.hoverActions && (
                    <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <RowAction label="Forward" onClick={() => onForward(message)}>
                        <Forward size={14} />
                      </RowAction>
                      <RowAction label="Delete" onClick={() => onDelete(message)}>
                        <Trash2 size={14} />
                      </RowAction>
                      <RowAction
                        label={archived ? 'Вернуть из архива' : 'В архив'}
                        onClick={() => onArchive(message)}
                      >
                        {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </RowAction>
                      <RowAction
                        label={message.starred ? 'Убрать из избранного' : 'В избранное'}
                        active={message.starred}
                        onClick={() => onStar(message)}
                      >
                        <Star size={14} className={message.starred ? 'fill-current' : undefined} />
                      </RowAction>
                      {/* Attach message to a CRM record (ADR-158 §P2). The trigger
                          is the Radix popover anchor itself (RowAction can't forward
                          the ref asChild needs); stopPropagation keeps the row from
                          opening underneath. Icon fills when the message is linked. */}
                      <MailLinkPopover
                        spaceId={spaceId}
                        message={message}
                        align="end"
                        trigger={
                          <button
                            type="button"
                            aria-label={
                              message.linkedRowId != null
                                ? 'Изменить привязку к записи'
                                : 'Привязать к записи'
                            }
                            title={
                              message.linkedRowId != null
                                ? 'Изменить привязку к записи'
                                : 'Привязать к записи'
                            }
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                              message.linkedRowId != null
                                ? 'text-[var(--color-primary-600)] hover:bg-[var(--bg-secondary)]'
                                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                            )}
                          >
                            <Link2 size={14} />
                          </button>
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — body preview glued to the row. On open this whole column is
                covered by the reading pane. Hidden on phones (single-column list)
                and when snippets are disabled. */}
            <button
              type="button"
              onClick={() => onSelect(message.id)}
              className="hidden min-w-0 flex-1 flex-col justify-start px-4 py-2 text-left md:flex"
            >
              {settings.showSnippets && (
                <span className="line-clamp-3 max-w-prose text-xs leading-snug text-[var(--text-tertiary)]">
                  {cleanPreview(message.preview) || <span className="italic opacity-70">No preview</span>}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
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
