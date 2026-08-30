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
  /**
   * Recipient addresses (backend `to_addresses` jsonb → string[]; empty → []).
   * For outgoing folders (sent/drafts) the UI shows this as the contact instead
   * of `fromAddress`, which is our own mailbox. See `isOutgoingFolder`.
   */
  to: string[];
  subject: string;
  preview: string;
  body: string;
  /** ISO-8601 */
  date: string;
  read: boolean;
  /** Bookmark/flag (backend `starred`). Toggled from the list row. */
  starred?: boolean;
  /** ADR-158 §P5 — attachment metadata (no bytes); [] when none. */
  attachments?: MailAttachmentMeta[];
  /**
   * ADR-173 §B.4 — labels attached to this message (batched serializer, no N+1).
   * Compact refs for chips; the full label lives in the rail/manager. [] when none.
   */
  labels?: MailLabelRef[];
  /** ADR-158 reply-matching: `[ticket:<token>]` resolves to this row. */
  ticketId?: number | null;
  /**
   * ADR-158 §P2 — generic CRM-row linkage (attach this email to a
   * deal/lead/ticket/person). Both null when unlinked; set together via
   * PUT …/messages/:id/link. Emitted by `toMailMessage` (backend/routes/v3/mail.js).
   */
  linkedTableId?: number | null;
  linkedRowId?: number | null;
}

/**
 * ADR-158 §P5 — compact snapshot of a mail message, attached to a chat message
 * so it renders as a `MailMessageChip`. Structurally identical to the backend
 * `toMailRef` serializer (`backend/routes/v3/mail.js`), which also backs
 * `GET /spaces/:spaceId/mail/messages/:msgId/ref` for stale re-resolution.
 *
 * `mail_messages` rows are physical (BIGSERIAL, not in `table_rows`), so the
 * generic `row_reference` attachment can't point at them — this dedicated ref
 * carries the display snapshot inline (no N+1 at render time).
 */
export interface MailMessageRef {
  /** `String(id)` — `Number()` it when keying numerically. */
  messageId: string;
  spaceId: number;
  connectorId: number | null;
  folder: MailFolderId;
  subject: string;
  /** Already falls back to `fromAddress` server-side. */
  fromName: string;
  fromAddress: string;
  to: string[];
  /** ISO-8601, or `null` when the row has no date. */
  date: string | null;
  read: boolean;
  /** Drives the 📎 indicator; `attachmentCount > 0`. */
  attachmentCount: number;
  preview: string;
}

/**
 * ADR-173 §P4 — label rule DSL. A label with an empty/absent `conditions` array
 * is manual-only (never auto-applied by the sync hook). `match` decides whether
 * ALL conditions must hold or ANY one.
 */
export type MailRuleField = 'from' | 'to' | 'subject' | 'body' | 'any';
export type MailRuleOp = 'contains' | 'in_list' | 'equals' | 'regex' | 'in_table';

/**
 * `op: 'in_table'` — the match list is pulled live from a CRM table column at
 * sync time instead of being a static list (ADR-173 ext, 2026-07-15). The
 * message field matches if it CONTAINS any value of `column`, optionally
 * narrowed to rows where `filter.column <op> filter.value`. The backend
 * resolves the value set (space-scoped) and feeds it to the existing
 * substring matcher, so `labelRules` stays pure.
 */
export interface MailTableSource {
  tableId: number;
  /** Column whose distinct values become the match list (e.g. "order number"). */
  column: string;
  /** Optional row filter (e.g. status = "active"). */
  filter?: {
    column: string;
    op: 'equals' | 'contains';
    value: string;
  };
}

export interface MailLabelCondition {
  field: MailRuleField;
  op: MailRuleOp;
  /** `in_list` carries a string[]; `contains`/`equals`/`regex` a single string. */
  value?: string | string[];
  /** Present only for `op: 'in_table'`. */
  source?: MailTableSource;
}

export interface MailLabelRules {
  match: 'any' | 'all';
  conditions: MailLabelCondition[];
}

/**
 * Full label row — powers the rail and the "Ярлыки" manager. `rules` is `{}` (no
 * conditions) for a manual-only label; the manager normalizes it to a
 * {@link MailLabelRules} for editing. `messageCount` is present only on the list
 * endpoint (rail badge) and absent on create/update responses.
 */
export interface MailLabel {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  showInToolbar: boolean;
  rules: MailLabelRules | Record<string, never>;
  orderIndex: number;
  enabled: boolean;
  messageCount?: number;
}

/** Compact label reference carried on each message (row/reader chips). */
export interface MailLabelRef {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
}

/**
 * Attachment metadata surfaced on a read message (backend `attachments` jsonb).
 * Bytes are NOT carried — this is name/type/size for display; a download-the-file
 * endpoint is a later enhancement (same note as the send path).
 */
export interface MailAttachmentMeta {
  filename: string;
  contentType: string;
  /** Decoded size in bytes. */
  size: number;
}

/**
 * Outgoing attachment carried inline in the send body (base64). Kept small — the
 * send endpoint guards total size; large files are a future upload-then-reference
 * enhancement.
 */
export interface MailAttachment {
  filename: string;
  contentType: string;
  /** base64-encoded bytes (no data: prefix). */
  content: string;
}

/**
 * Sent/Drafts are outgoing: the meaningful contact is the recipient (`to`), not
 * `fromAddress`. Single source of truth so list + display panes stay in sync.
 */
export function isOutgoingFolder(folder: MailFolderId): boolean {
  return folder === 'sent' || folder === 'drafts';
}

/**
 * ADR-158 §P6 — a message queued for delayed send (`mail_outbox`). `pending` is
 * still cancelable; once the worker claims it the row goes `sending` → `sent`
 * (or `failed`), and a user cancel returns `canceled`. `preview`/`attachmentCount`
 * are display-only projections of the stored payload (the bytes live server-side).
 */
export type MailScheduledStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface MailScheduled {
  id: number;
  connectorId: number | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  preview: string;
  /**
   * Full composed body (HTML/text as stored) — powers the "Отложенные" editor,
   * which reopens a queued send fully pre-filled. `preview` is the short list
   * snippet; `body` is the editable content.
   */
  body: string;
  isHtml: boolean;
  attachmentCount: number;
  linkedTableId: number | null;
  linkedRowId: number | null;
  /** ISO-8601 — when the worker will send it. */
  scheduledAt: string;
  status: MailScheduledStatus;
  errorMessage: string | null;
  sentMessageId: string | null;
  createdAt: string;
}
