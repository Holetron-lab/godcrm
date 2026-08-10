// ADR-158 — In-CRM Mail Module. P1 inbox UI types.
// Mirrors the planned `mail_messages` row shape so slice 2 can swap mock data
// for `/api/v3` over the real table without touching the presentational panes.

export type MailFolderId = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash';

export interface MailFolder {
  id: MailFolderId;
  label: string;
  unread?: number;
}

export interface MailMessage {
  id: string;
  folder: MailFolderId;
  fromName: string;
  fromAddress: string;
  subject: string;
  preview: string;
  body: string;
  /** ISO-8601 */
  date: string;
  read: boolean;
  /** ADR-158 reply-matching: `[ticket:<token>]` resolves to this row. */
  ticketId?: number | null;
}
