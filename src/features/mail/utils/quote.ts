// ADR-158 — reply/forward quoting. Builds a standard plain-text quote block to
// seed the inline composer (MailReplyBar). Bodies are HTML (backend
// `body_html || body_text`), so we flatten to text before quoting — raw tags
// in a plain-text quote read badly.
import { isOutgoingFolder, type MailMessage } from '../types';

export interface ComposeSeed {
  to?: string;
  subject?: string;
  body?: string;
}

/**
 * Flatten HTML to readable text for quoting. Parsed off-DOM (never inserted into
 * the live page), so no scripts run and nothing renders — this is a read of
 * `textContent`, not a sink.
 */
function htmlToText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Strip an existing Re:/Fwd: prefix so replies/forwards don't stack them. */
function baseSubject(subject: string): string {
  return subject.replace(/^\s*(re|fwd?)\s*:\s*/i, '').trim();
}

export function buildReply(message: MailMessage): ComposeSeed {
  // Replying to our own outgoing mail targets the original recipient, not us.
  const to = isOutgoingFolder(message.folder)
    ? message.to?.[0] ?? ''
    : message.fromAddress;
  const author = message.fromName
    ? `${message.fromName} <${message.fromAddress}>`
    : message.fromAddress;
  const quoted = htmlToText(message.body)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return {
    to,
    subject: `Re: ${baseSubject(message.subject)}`,
    body: `\n\nOn ${formatDate(message.date)}, ${author} wrote:\n${quoted}\n`,
  };
}

export function buildForward(message: MailMessage): ComposeSeed {
  const header = [
    '---------- Forwarded message ----------',
    `From: ${message.fromName} <${message.fromAddress}>`,
    `Date: ${formatDate(message.date)}`,
    `Subject: ${message.subject}`,
    message.to?.length ? `To: ${message.to.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    subject: `Fwd: ${baseSubject(message.subject)}`,
    body: `\n\n${header}\n\n${htmlToText(message.body)}\n`,
  };
}
