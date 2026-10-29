/**
 * ADR-158 §P6 — the "Отложенные" view: the outbox queue rendered in the mail
 * module's center pane when the rail's scheduled pseudo-folder is active.
 *
 * Rows use the SAME two-column skeleton as the inbox/outgoing list (`MailList`):
 * a fixed-width meta column (recipient + date · subject · status line) glued to a
 * flex body-preview column that the composer overlay later covers — so the queue
 * reads as an ordinary folder, not a separate widget. The one line the inbox
 * doesn't have is how long until it goes out ("уйдёт через N"). Clicking a still-
 * `pending` row opens it in the composer, fully pre-filled and editable (reschedule
 * / edit / send now). `sending`/`failed` rows are read-only — the worker has them,
 * so there's nothing to reopen; a `pending` row also keeps a Cancel action on hover.
 */
import { Clock, X, Paperclip, Loader2, AlertTriangle, Send as SendIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage, type LanguageContextValue } from '@/shared/i18n/LanguageContext';
import type { MailScheduled, MailScheduledStatus } from '../types';

interface MailScheduledListProps {
  scheduled: MailScheduled[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Open a pending row in the composer (pre-filled + editable). */
  onOpen: (item: MailScheduled) => void;
  onCancel: (id: number) => void;
  /** Width (px) of the left meta column — driven by the list's full-height divider. */
  listWidth: number;
  /** When false, the glued body-preview column is hidden (mirrors MailList). */
  showSnippets: boolean;
  /** Id of the row currently open in the composer — highlights it in the list. */
  openId?: number | null;
  /** Id currently being canceled — disables its button + shows a spinner. */
  cancelingId?: number | null;
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/**
 * The stored composed body is HTML (`isHtml`), so the raw string carries tags and
 * entities — strip them to a clean snippet, matching the plain-text previews the
 * inbox stores. Derived from the full `body` (not the pre-sliced `preview`) so tags
 * are never cut mid-token; line-clamp handles the visual truncation.
 */
function bodyToPreview(item: MailScheduled): string {
  let text = item.body || item.preview || '';
  if (item.isHtml && /<[a-z/]/i.test(text)) {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/(script|style)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  text = text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? ' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 280);
}

/** Relative-then-absolute, mirroring the AI-chat scheduled badge. */
function formatScheduledTime(iso: string, t: LanguageContextValue['t']): string {
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return t('mail.scheduled.now');
  if (diff < 60_000) return t('mail.scheduled.lessThanMinute');
  if (diff < 3600_000) return t('mail.scheduled.minutes', { n: Math.round(diff / 60_000) });
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3600_000);
    const mins = Math.round((diff % 3600_000) / 60_000);
    return t('mail.scheduled.hours', { n: hours }) + (mins > 0 ? ` ${t('mail.scheduled.minutes', { n: mins })}` : '');
  }
  return t('mail.scheduled.days', { n: Math.round(diff / 86_400_000) });
}

/** Short date/time chip shown in the row's top-right, like the inbox date column. */
function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatAbsolute(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Pill colour per status; the label is `mail.scheduled.status.<status>`.
const STATUS_CLASS: Record<MailScheduledStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-500',
  sending: 'bg-blue-500/15 text-blue-500',
  sent: 'bg-green-500/15 text-green-500',
  failed: 'bg-red-500/15 text-red-500',
  canceled: 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]',
};

export function MailScheduledList({
  scheduled,
  isLoading,
  isError,
  onRetry,
  onOpen,
  onCancel,
  listWidth,
  showSnippets,
  openId,
  cancelingId,
}: MailScheduledListProps) {
  const { t, language } = useLanguage();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
        {t('mail.scheduled.loading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]">
        <span>{t('mail.scheduled.loadFailed')}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[var(--border-primary)] px-3 py-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
        >
          {t('mail.common.retry')}
        </button>
      </div>
    );
  }

  if (scheduled.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[var(--text-tertiary)]">
        <Clock className="h-8 w-8 opacity-40" />
        <p className="text-sm font-medium text-[var(--text-secondary)]">{t('mail.scheduled.empty')}</p>
        <p className="max-w-xs text-xs">
          {t('mail.scheduled.emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--border-primary)]">
      {scheduled.map((s) => {
        const statusKey: MailScheduledStatus = s.status in STATUS_CLASS ? s.status : 'pending';
        const canOpen = s.status === 'pending';
        const canCancel = s.status === 'pending';
        const busy = cancelingId === s.id;
        const active = openId === s.id;

        const preview = bodyToPreview(s);

        return (
          <li
            key={s.id}
            className={cn(
              'group relative flex min-h-[84px] items-stretch transition-colors',
              active ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
            )}
            // A pending row's amber time-badge glows down the left edge, echoing the
            // inbox's type stripe so the queue still reads as a mail folder.
            style={
              s.status === 'pending'
                ? { boxShadow: 'inset 3px 0 0 0 var(--color-warning, #f59e0b)' }
                : undefined
            }
          >
            {/* LEFT — the meta column, same skeleton as MailList: a leading glyph
                (the queue's analog of the checkbox) + a 3-line stack. Full width on
                phones; from md its width tracks the list's full-height divider so the
                composer overlay aligns to the same edge. */}
            <div
              className="flex w-full flex-shrink-0 items-start gap-2 py-2 pl-3 pr-2 md:w-[var(--meta-w)]"
              style={{ '--meta-w': `${listWidth}px` } as React.CSSProperties}
            >
              {/* Leading status glyph — pending=send, sending=spinner, failed=alert. */}
              <span className="mt-1 flex-shrink-0 text-[var(--text-tertiary)]">
                {s.status === 'sending' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                ) : s.status === 'failed' ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <SendIcon className="h-4 w-4" />
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Line 1 — recipient + fire time (the inbox's sender + date row). */}
                <button
                  type="button"
                  disabled={!canOpen}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => canOpen && onOpen(s)}
                  className={cn(
                    'flex w-full items-baseline gap-2 text-left',
                    canOpen ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                    {s.to.length ? t('mail.scheduled.toPrefix', { list: s.to.join(', ') }) : t('mail.scheduled.noRecipient')}
                  </span>
                  {s.attachmentCount > 0 && (
                    <Paperclip size={12} className="flex-shrink-0 text-[var(--text-tertiary)]" aria-label={t('mail.scheduled.hasAttachments')} />
                  )}
                  <time
                    className="flex-shrink-0 text-xs text-[var(--text-tertiary)]"
                    title={formatAbsolute(s.scheduledAt, language)}
                  >
                    {formatWhen(s.scheduledAt, language)}
                  </time>
                </button>

                {/* Line 2 — subject. */}
                <button
                  type="button"
                  disabled={!canOpen}
                  onClick={() => canOpen && onOpen(s)}
                  className={cn(
                    'w-full truncate text-left text-xs text-[var(--text-secondary)]',
                    canOpen ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  {s.subject || t('mail.common.noSubject')}
                </button>

                {s.status === 'failed' && s.errorMessage && (
                  <p className="truncate text-xs text-red-500" title={s.errorMessage}>
                    {s.errorMessage}
                  </p>
                )}

                {/* Line 3 — the extra line the inbox doesn't have: time-to-send +
                    status + hover Cancel. Pending shows "уйдёт через N"; terminal
                    states just show the status pill. */}
                <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                  {s.status === 'pending' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-500">
                      <Clock className="h-3 w-3" />
                      {t('mail.scheduled.goesOutIn', { time: formatScheduledTime(s.scheduledAt, t) })}
                    </span>
                  ) : (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', STATUS_CLASS[statusKey])}>
                      {t(`mail.scheduled.status.${statusKey}`)}
                    </span>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(s.id)}
                      disabled={busy}
                      aria-label={t('mail.scheduled.cancel')}
                      title={t('mail.scheduled.cancel')}
                      className="ml-auto flex-shrink-0 rounded-md p-1 text-[var(--text-tertiary)] opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — body preview glued to the row, same as MailList. Covered by
                the composer overlay on open; hidden on phones and when snippets off. */}
            {showSnippets && (
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => canOpen && onOpen(s)}
                className={cn(
                  'hidden min-w-0 flex-1 flex-col justify-start px-4 py-2 text-left md:flex',
                  canOpen ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                <span className="line-clamp-3 text-xs leading-snug text-[var(--text-tertiary)]">
                  {preview || <span className="italic opacity-70">{t('mail.scheduled.noPreview')}</span>}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
