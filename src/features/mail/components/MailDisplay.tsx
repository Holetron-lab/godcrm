import { Paperclip } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { SafeHtml } from '@/shared/components/SafeHtml';
import { isOutgoingFolder, type MailMessage } from '../types';
import type { MailBodyTheme } from '../settings';
import { MailAttachmentChip, useMailAttachmentDialogs } from './MailAttachmentChips';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MailDisplayProps {
  message: MailMessage | null;
  /**
   * Render the body as sanitized HTML (true) or as escaped raw source (false).
   * Owned by MailPage and driven from the toolbar's body view-type selector.
   */
  renderHtml: boolean;
  /** Light (white page) or dark surface for the body — see mail.css. */
  bodyTheme: MailBodyTheme;
  /** Needed for attachment bytes (download / viewer URLs). */
  spaceId?: number;
}

/** one / few / many — the Russian plural categories; English maps few+many to the same string. */
function pluralForm(n: number): 'one' | 'few' | 'many' {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'few';
  return 'many';
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function MailDisplay({ message, renderHtml, bodyTheme, spaceId }: MailDisplayProps) {
  // Attachment strip dialogs (all-files modal + image viewer) — same chips as the list row.
  const { openImage, dialogs } = useMailAttachmentDialogs(spaceId);
  const { t } = useLanguage();
  if (!message) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-tertiary)]">
        {t('mail.display.pickMessage')}
      </div>
    );
  }

  // Outgoing threads (sent/drafts) are addressed to the recipient — show `to`,
  // not our own mailbox. We only have recipient addresses (no display name).
  const outgoing = isOutgoingFolder(message.folder);
  const recipients = message.to?.filter(Boolean) ?? [];
  const fullDate = message.date ? formatFullDate(message.date) : '';
  const attachments = message.attachments ?? [];
  const attachmentsForm = pluralForm(attachments.length);

  return (
    // `id` scopes the print stylesheet (mail.css) so Print isolates this pane.
    <article id="mail-print-root" className="flex flex-col md:h-full">
      <header className="flex items-start gap-3 border-b border-[var(--border-primary)] p-4">
        <Avatar name={outgoing ? recipients[0] ?? message.subject : message.fromName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
            <h2 className="min-w-0 flex-1 break-words text-base font-semibold text-[var(--text-primary)] md:truncate">
              {message.subject || t('mail.common.noSubject')}
            </h2>
            {fullDate && (
              <time className="flex-shrink-0 text-xs text-[var(--text-tertiary)]">{fullDate}</time>
            )}
          </div>
          <p className="truncate text-sm text-[var(--text-secondary)]">
            {outgoing ? (
              recipients.length > 0 ? (
                <>
                  <span className="text-[var(--text-tertiary)]">{t('mail.common.to')}:</span> {recipients.join(', ')}
                </>
              ) : (
                <span className="text-[var(--text-tertiary)]">{t('mail.common.noRecipient')}</span>
              )
            ) : (
              <>
                {message.fromName}{' '}
                <span className="text-[var(--text-tertiary)]">&lt;{message.fromAddress}&gt;</span>
              </>
            )}
          </p>
          {/* Incoming mail: surface the recipient line too (Gmail's "to me"/list). */}
          {!outgoing && recipients.length > 0 && (
            <p className="truncate text-xs text-[var(--text-tertiary)]">
              {t('mail.common.to')}: {recipients.join(', ')}
            </p>
          )}
        </div>
      </header>
      {/* Attachment strip — thumbnails open the viewer, files download (ADR-158 §P5). */}
      {attachments.length > 0 && spaceId != null && (
        <div className="flex flex-wrap items-start gap-2 border-b border-[var(--border-primary)] px-4 py-2.5">
          <span className="flex w-full items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            <Paperclip className="h-3.5 w-3.5" />
            {t(`mail.display.attachments.${attachmentsForm}`, { count: attachments.length })}
          </span>
          {attachments.map((att, i) => (
            <MailAttachmentChip
              key={`${att.filename}-${i}`}
              spaceId={spaceId}
              message={message}
              index={i}
              att={att}
              onOpenImage={openImage}
            />
          ))}
        </div>
      )}
      {dialogs}
      {/* Bodies are HTML (backend `body_html || body_text`); render sanitized so
          formatting shows instead of literal tags. SafeHtml passes plain-text
          bodies through unchanged (no tags to strip). Toolbar toggle swaps to a
          raw source view — escaped by React's text node, never interpreted.
          `data-mail-theme` picks the light/dark body surface (mail.css). */}
      <div data-mail-theme={bodyTheme} className="flex min-h-0 flex-1 flex-col">
        {renderHtml ? (
          <SafeHtml
            html={message.body}
            className="mail-body flex-1 overflow-auto p-6 text-sm leading-relaxed"
          />
        ) : (
          <pre className="mail-body flex-1 overflow-auto whitespace-pre-wrap break-words p-6 font-mono text-xs leading-relaxed">
            {message.body}
          </pre>
        )}
      </div>
    </article>
  );
}
