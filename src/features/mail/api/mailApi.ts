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
import type { MailFolder, MailFolderId, MailMessage } from '../types';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
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
};
