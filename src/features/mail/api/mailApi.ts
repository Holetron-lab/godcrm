/**
 * ADR-160 — Mail module API client (the bridge slice).
 *
 * Backend contract: backend/routes/v3/mail.js — mounted at
 * `/api/v3` (sibling of /spaces/:id/connectors). All responses are wrapped in
 * `{ success, data, timestamp }` (backend/utils/response.js), matching connectorsApi.
 *
 * The server already returns rows in the `MailMessage` shape (toMailMessage),
 * so the presentational panes consume this verbatim — no client-side mapping.
 */
import { apiClient } from '@/shared/utils/apiClient';
import type {
  MailAttachment,
  MailFolder,
  MailFolderId,
  MailLabel,
  MailLabelRules,
  MailMessage,
  MailScheduled,
  MailScheduledStatus,
} from '../types';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Create/update payload for a label — snake_case to match the backend body
 * (backend/routes/v3/mail.js). `rules: null` clears rules (manual-only); omit a
 * field to leave it unchanged on PATCH.
 */
export interface MailLabelInput {
  name: string;
  icon?: string | null;
  color?: string | null;
  show_in_toolbar?: boolean;
  rules?: MailLabelRules | null;
  order_index?: number;
  enabled?: boolean;
}

/** Fields the PATCH endpoint accepts — mark (un)read, star, move folder. */
export interface MailPatch {
  is_read?: boolean;
  starred?: boolean;
  folder?: MailFolderId;
}

/** Send payload — `html` flips the body between text/HTML; attachments optional. */
export interface MailSendInput {
  /** One address or many — backend `normalizeRecipients` accepts a string[] verbatim. */
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
  attachments?: MailAttachment[];
}

export const mailApi = {
  async folders(spaceId: number, connectorId: number | null): Promise<MailFolder[]> {
    // `connector_id` picks the mailbox (account switcher); omitted → most recent active.
    const q = connectorId ? `?connector_id=${connectorId}` : '';
    const r = await apiClient.get<SuccessEnvelope<{ folders: MailFolder[] }>>(
      `/spaces/${spaceId}/mail/folders${q}`
    );
    return r.data.folders;
  },

  async messages(
    spaceId: number,
    folder: MailFolderId,
    connectorId: number | null
  ): Promise<MailMessage[]> {
    const q = connectorId ? `&connector_id=${connectorId}` : '';
    const r = await apiClient.get<SuccessEnvelope<{ messages: MailMessage[] }>>(
      `/spaces/${spaceId}/mail/messages?folder=${folder}${q}`
    );
    return r.data.messages;
  },

  /** GET marks the message read server-side and returns the fresh row. */
  async message(spaceId: number, msgId: string): Promise<MailMessage> {
    const r = await apiClient.get<SuccessEnvelope<{ message: MailMessage }>>(
      `/spaces/${spaceId}/mail/messages/${msgId}`
    );
    return r.data.message;
  },

  /** Mutate flags/placement: mark (un)read, star/unstar, archive/trash (folder). */
  async update(spaceId: number, msgId: string, patch: MailPatch): Promise<MailMessage> {
    const r = await apiClient.patch<SuccessEnvelope<{ message: MailMessage }>>(
      `/spaces/${spaceId}/mail/messages/${msgId}`,
      patch
    );
    return r.data.message;
  },

  /**
   * ADR-158 §P2 — attach the message to a CRM row (deal/lead/ticket/person/…),
   * or clear the link with `target: null`. Manual counterpart to the reply-token
   * auto-link. PUT …/messages/:id/link — both ids present to link, both null to
   * unlink (backend rejects a half-set pair).
   */
  async link(
    spaceId: number,
    msgId: string,
    target: { tableId: number; rowId: number } | null
  ): Promise<MailMessage> {
    const r = await apiClient.put<SuccessEnvelope<{ message: MailMessage }>>(
      `/spaces/${spaceId}/mail/messages/${msgId}/link`,
      target
        ? { linked_table_id: target.tableId, linked_row_id: target.rowId }
        : { linked_table_id: null, linked_row_id: null }
    );
    return r.data.message;
  },

  /** Pull newest N from IMAP into mail_messages, then the list query refetches. */
  async sync(
    spaceId: number,
    folder: MailFolderId,
    connectorId: number | null
  ): Promise<{ synced: number; folder: string }> {
    const r = await apiClient.post<SuccessEnvelope<{ synced: number; folder: string }>>(
      `/spaces/${spaceId}/mail/sync`,
      { folder, connector_id: connectorId ?? undefined }
    );
    return r.data;
  },

  /** Send via the active connector's SMTP creds; server also persists a Sent copy. */
  async send(
    spaceId: number,
    connectorId: number | null,
    msg: MailSendInput
  ): Promise<{ messageId: string | null }> {
    const r = await apiClient.post<SuccessEnvelope<{ messageId: string | null }>>(
      `/spaces/${spaceId}/mail/send`,
      { ...msg, connector_id: connectorId ?? undefined }
    );
    return r.data;
  },

  /**
   * ADR-158 §P6 — save the composition as a Drafts message without sending. `to`
   * may be empty (a draft is precisely something not ready to go out); passing an
   * existing draft's `id` re-saves it in place instead of spawning a duplicate.
   */
  async saveDraft(
    spaceId: number,
    connectorId: number | null,
    msg: MailSendInput,
    draftId?: number
  ): Promise<MailMessage> {
    const r = await apiClient.post<SuccessEnvelope<{ message: MailMessage }>>(
      `/spaces/${spaceId}/mail/drafts`,
      { ...msg, id: draftId, connector_id: connectorId ?? undefined }
    );
    return r.data.message;
  },

  /**
   * ADR-158 §P6 — delayed send. Same `/send` endpoint + a `scheduledAt` ISO date:
   * the server enqueues into `mail_outbox` (bytes preserved) instead of sending now
   * and the scheduled worker transmits at the due time. Returns the queued row.
   */
  async scheduleSend(
    spaceId: number,
    connectorId: number | null,
    msg: MailSendInput,
    scheduledAt: string
  ): Promise<{ scheduled: MailScheduled }> {
    const r = await apiClient.post<SuccessEnvelope<{ scheduled: MailScheduled }>>(
      `/spaces/${spaceId}/mail/send`,
      { ...msg, scheduledAt, connector_id: connectorId ?? undefined }
    );
    return r.data;
  },

  /**
   * ADR-158 §P6 — the scheduled queue (`mail_outbox`). `list` powers the left-rail
   * "Отложенные" view; `cancel` drops a still-pending row (409 if the worker has
   * already claimed it — we surface that honestly rather than pretend it stopped).
   */
  scheduled: {
    async list(
      spaceId: number,
      params?: { status?: MailScheduledStatus; limit?: number }
    ): Promise<MailScheduled[]> {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.limit) qs.set('limit', String(params.limit));
      const suffix = qs.toString() ? `?${qs}` : '';
      const r = await apiClient.get<SuccessEnvelope<{ scheduled: MailScheduled[] }>>(
        `/spaces/${spaceId}/mail/scheduled${suffix}`
      );
      return r.data.scheduled;
    },

    async cancel(spaceId: number, id: number): Promise<{ canceled: true; id: number }> {
      const r = await apiClient.delete<SuccessEnvelope<{ canceled: true; id: number }>>(
        `/spaces/${spaceId}/mail/scheduled/${id}`
      );
      return r.data;
    },

    /**
     * ADR-158 §P6 — edit a still-`pending` queued send in place (recipients /
     * subject / body / fire time). Editing in place keeps the row's stored
     * attachment bytes, which the composer can't re-upload; 409 once the worker
     * has claimed it. `scheduledAt` is an ISO date in the future.
     */
    async update(
      spaceId: number,
      id: number,
      msg: MailSendInput,
      scheduledAt: string
    ): Promise<MailScheduled> {
      const r = await apiClient.patch<SuccessEnvelope<{ scheduled: MailScheduled }>>(
        `/spaces/${spaceId}/mail/scheduled/${id}`,
        { ...msg, scheduledAt }
      );
      return r.data.scheduled;
    },
  },

  /**
   * ADR-173 §P4 — label CRUD + message tagging. Rail badges come off `list`
   * (each label carries `messageCount`); create/update omit it. Tagging a message
   * promotes any existing rule-link to `manual` server-side.
   */
  labels: {
    async list(spaceId: number): Promise<MailLabel[]> {
      const r = await apiClient.get<SuccessEnvelope<{ labels: MailLabel[] }>>(
        `/spaces/${spaceId}/mail/labels`
      );
      return r.data.labels;
    },

    async create(spaceId: number, input: MailLabelInput): Promise<MailLabel> {
      const r = await apiClient.post<SuccessEnvelope<{ label: MailLabel }>>(
        `/spaces/${spaceId}/mail/labels`,
        input
      );
      return r.data.label;
    },

    async update(
      spaceId: number,
      labelId: number,
      patch: Partial<MailLabelInput>
    ): Promise<MailLabel> {
      const r = await apiClient.patch<SuccessEnvelope<{ label: MailLabel }>>(
        `/spaces/${spaceId}/mail/labels/${labelId}`,
        patch
      );
      return r.data.label;
    },

    async remove(spaceId: number, labelId: number): Promise<{ deleted: true; id: number }> {
      const r = await apiClient.delete<SuccessEnvelope<{ deleted: true; id: number }>>(
        `/spaces/${spaceId}/mail/labels/${labelId}`
      );
      return r.data;
    },

    /** Backfill: re-sync this label's rule-links over existing messages. */
    async apply(
      spaceId: number,
      labelId: number
    ): Promise<{ applied: number; scanned: number; capped: boolean }> {
      const r = await apiClient.post<
        SuccessEnvelope<{ applied: number; scanned: number; capped: boolean }>
      >(`/spaces/${spaceId}/mail/labels/${labelId}/apply`, {});
      return r.data;
    },

    /** Manual-tag a message with a label (idempotent upsert). */
    async tag(spaceId: number, msgId: string, labelId: number): Promise<void> {
      await apiClient.post<SuccessEnvelope<unknown>>(
        `/spaces/${spaceId}/mail/messages/${msgId}/labels`,
        { label_id: labelId }
      );
    },

    /** Remove a label from a message. */
    async untag(spaceId: number, msgId: string, labelId: number): Promise<void> {
      await apiClient.delete<SuccessEnvelope<unknown>>(
        `/spaces/${spaceId}/mail/messages/${msgId}/labels/${labelId}`
      );
    },
  },
};
