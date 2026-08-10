import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi } from '../api/mailApi';
import type { MailFolder, MailFolderId, MailMessage } from '../types';

/**
 * ADR-160 — mail read-path hooks. Keyed by space + connector (the mailbox) so the
 * account switcher isolates each mailbox's cache. React Query dedupes and refetches.
 */

const keys = {
  folders: (spaceId: number | undefined, connectorId: number | null) =>
    ['mail', 'folders', spaceId, connectorId] as const,
  messages: (
    spaceId: number | undefined,
    folder: MailFolderId,
    connectorId: number | null
  ) => ['mail', 'messages', spaceId, folder, connectorId] as const,
  message: (spaceId: number | undefined, msgId: string | null) =>
    ['mail', 'message', spaceId, msgId] as const,
};

export function useMailFolders(spaceId: number | undefined, connectorId: number | null) {
  return useQuery<MailFolder[]>({
    queryKey: keys.folders(spaceId, connectorId),
    queryFn: () => mailApi.folders(spaceId!, connectorId),
    enabled: Number.isFinite(spaceId),
    staleTime: 30_000,
  });
}

export function useMailMessages(
  spaceId: number | undefined,
  folder: MailFolderId,
  connectorId: number | null
) {
  return useQuery<MailMessage[]>({
    queryKey: keys.messages(spaceId, folder, connectorId),
    queryFn: () => mailApi.messages(spaceId!, folder, connectorId),
    // The endpoint returns [] when no mailbox is connected, so gate only on space.
    enabled: Number.isFinite(spaceId),
    staleTime: 15_000,
  });
}

/**
 * Fetch one message — the GET marks it read server-side. On success we invalidate
 * the folder/list caches so the unread badge and read dot update without a manual
 * refetch.
 */
export function useMailMessage(spaceId: number | undefined, msgId: string | null) {
  const qc = useQueryClient();
  return useQuery<MailMessage>({
    queryKey: keys.message(spaceId, msgId),
    queryFn: async () => {
      const message = await mailApi.message(spaceId!, msgId!);
      qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      return message;
    },
    enabled: Number.isFinite(spaceId) && !!msgId,
    staleTime: 60_000,
  });
}

/** Pull newest mail from IMAP, then refresh the current folder + counts. */
export function useSyncMail(spaceId: number | undefined, connectorId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folder: MailFolderId) => mailApi.sync(spaceId!, folder, connectorId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
    },
  });
}
