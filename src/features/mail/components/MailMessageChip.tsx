/**
 * MailMessageChip — ADR-158 §P5.
 *
 * Renders a compact snapshot of a mail message attached to a chat message
 * (attachment `type === 'mail_message_ref'`). The snapshot travels inline on the
 * attachment (`MailMessageRef`, backend `toMailRef`), so there is no fetch at
 * render time. Clicking deep-links into the mail reader (`/mail?msg=…&folder=…`),
 * where opening the message is what marks it read — never on render.
 *
 * Deliberately NOT reusing the `row_reference` chip: mail rows are physical (not
 * universal table rows) and the click target is the reader, not the row viewer.
 */
import { Mail, Paperclip } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { MailMessageRef } from '../types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MailMessageChipProps {
  mailRef: MailMessageRef;
}

/** Short, unambiguous date: time today, "MMM d" this year, else numeric. */
function formatChipDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

export function MailMessageChip({ mailRef }: MailMessageChipProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const sender = mailRef.fromName || mailRef.fromAddress || t('mail.chip.noSender');
  const subject = mailRef.subject || t('mail.common.noSubject');
  const when = formatChipDate(mailRef.date);
  const hasAttachments = mailRef.attachmentCount > 0;

  const openInReader = () => {
    navigate(`/mail?msg=${encodeURIComponent(mailRef.messageId)}&folder=${encodeURIComponent(mailRef.folder)}`);
  };

  return (
    <button
      type="button"
      onClick={openInReader}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg text-left bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] hover:bg-[rgba(59,130,246,0.12)] transition-colors"
      title={`${sender} · ${subject}${when ? ` · ${when}` : ''}`}
    >
      <Mail className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs truncate ${mailRef.read ? 'text-blue-300' : 'font-semibold text-blue-200'}`}>
            {sender}
          </span>
          {hasAttachments && (
            <Paperclip className="w-3 h-3 flex-shrink-0 text-blue-400/70" aria-label={t('mail.chip.hasAttachments')} />
          )}
          {when && <span className="ml-auto text-[10px] flex-shrink-0 text-blue-400/60">{when}</span>}
        </div>
        <div className="text-[11px] truncate text-blue-300/80">{subject}</div>
      </div>
    </button>
  );
}

export default MailMessageChip;
