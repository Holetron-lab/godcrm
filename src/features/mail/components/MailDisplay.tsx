import { Paperclip, FileText, Image as ImageIcon, File as FileIcon } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { SafeHtml } from '@/shared/components/SafeHtml';
import { isOutgoingFolder, type MailAttachmentMeta, type MailMessage } from '../types';

interface MailDisplayProps {
  message: MailMessage | null;
  /**
   * Render the body as sanitized HTML (true) or as escaped raw source (false).
   * Owned by MailPage and driven from the toolbar's body view-type selector.
   */
  renderHtml: boolean;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon className="h-4 w-4" />;
  if (type.includes('pdf') || type.includes('document')) return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

/**
 * Attachment strip — metadata chips (name · size) surfaced between header and
 * body so a message with attachments visibly shows them. Bytes aren't carried
 * yet (no download endpoint), so chips are non-interactive for now.
 */
function AttachmentStrip({ attachments }: { attachments: MailAttachmentMeta[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-primary)] px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <Paperclip className="h-3.5 w-3.5" />
        {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
      </span>
      {attachments.map((att, i) => (
        <span
          key={`${att.filename}-${i}`}
          title={`${att.filename} — ${formatBytes(att.size)}`}
          className="flex max-w-[220px] items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
        >
          {attachmentIcon(att.contentType)}
          <span className="min-w-0 flex-1 truncate">{att.filename}</span>
          <span className="flex-shrink-0 text-[var(--text-tertiary)]">{formatBytes(att.size)}</span>
        </span>
      ))}
    </div>
  );
}

export function MailDisplay({ message, renderHtml }: MailDisplayProps) {
  if (!message) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-tertiary)]">
        Select a message to read
      </div>
    );
  }

  // Outgoing threads (sent/drafts) are addressed to the recipient — show `to`,
  // not our own mailbox. We only have recipient addresses (no display name).
  const outgoing = isOutgoingFolder(message.folder);
  const recipients = message.to?.filter(Boolean) ?? [];
  const fullDate = message.date ? formatFullDate(message.date) : '';
  const attachments = message.attachments ?? [];

  return (
    // `id` scopes the print stylesheet (mail.css) so Print isolates this pane.
    <article id="mail-print-root" className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-[var(--border-primary)] p-4">
        <Avatar name={outgoing ? recipients[0] ?? message.subject : message.fromName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">
              {message.subject || '(no subject)'}
            </h2>
            {fullDate && (
              <time className="flex-shrink-0 text-xs text-[var(--text-tertiary)]">{fullDate}</time>
            )}
          </div>
          <p className="truncate text-sm text-[var(--text-secondary)]">
            {outgoing ? (
              recipients.length > 0 ? (
                <>
                  <span className="text-[var(--text-tertiary)]">To:</span> {recipients.join(', ')}
                </>
              ) : (
                <span className="text-[var(--text-tertiary)]">No recipient</span>
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
              To: {recipients.join(', ')}
            </p>
          )}
        </div>
      </header>
      {attachments.length > 0 && <AttachmentStrip attachments={attachments} />}
      {/* Bodies are HTML (backend `body_html || body_text`); render sanitized so
          formatting shows instead of literal tags. SafeHtml passes plain-text
          bodies through unchanged (no tags to strip). Toolbar toggle swaps to a
          raw source view — escaped by React's text node, never interpreted. */}
      {renderHtml ? (
        <SafeHtml
          html={message.body}
          className="mail-body flex-1 overflow-auto p-6 text-sm leading-relaxed text-[var(--text-primary)]"
        />
      ) : (
        <pre className="mail-body flex-1 overflow-auto whitespace-pre-wrap break-words p-6 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
          {message.body}
        </pre>
      )}
    </article>
  );
}

