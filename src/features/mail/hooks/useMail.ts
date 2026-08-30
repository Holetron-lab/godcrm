import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi, type MailPatch, type MailSendInput } from '../api/mailApi';
import type { MailFolder, MailFolderId, MailMessage, MailScheduled } from '../types';

/**
 * ADR-160 — mail read-path hooks. Keyed by space + connector (the mailbox) so the
 * account switcher isolates each mailbox's cache. React Query dedupes and refetches.
 *
 * Label hooks live in the sibling `useMailLabels.ts` (ADR-173 §P4) — labels are
 * space-scoped, not per-connector, so they key on `spaceId` alone.
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
  scheduled: (spaceId: number | undefined) => ['mail', 'scheduled', spaceId] as const,
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
 * Multi-folder read path (toolbar folder multiselect). Fans one list query out per
 * selected folder and merges the pages into a single newest-first list. Each query
 * reuses the same cache key as `useMailMessages`, so a single-folder view and this
 * merged view share cache entries (no double-fetch). De-dupes by id in case a
 * message surfaces in two selected folders.
 */
export function useMailMessagesMulti(
  spaceId: number | undefined,
  folders: MailFolderId[],
  connectorId: number | null
) {
  const results = useQueries({
    queries: folders.map((folder) => ({
      queryKey: keys.messages(spaceId, folder, connectorId),
      queryFn: () => mailApi.messages(spaceId!, folder, connectorId),
      enabled: Number.isFinite(spaceId),
      staleTime: 15_000,
    })),
  });

  // dataUpdatedAt changes only when a page actually refetches, so the merge is
  // stable across unrelated re-renders.
  const signature = results.map((r) => r.dataUpdatedAt).join('|');
  const data = useMemo(() => {
    const byId = new Map<string, MailMessage>();
    for (const r of results) for (const m of r.data ?? []) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return {
    data,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => results.forEach((r) => void r.refetch()),
  };
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

/**
 * Send a message through the active mailbox's SMTP. The server persists a Sent
 * copy, so on success we refresh the message lists (the Sent folder picks it up)
 * and the folder counts.
 */
export function useSendMail(spaceId: number | undefined, connectorId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (msg: MailSendInput) => mailApi.send(spaceId!, connectorId, msg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
    },
  });
}

/**
 * ADR-158 §P6 — save the composer contents to Drafts (no SMTP). On success we
 * refresh the message lists (the Drafts folder picks the row up) and the folder
 * counts so the rail badge reflects the new draft immediately.
 */
export function useSaveDraft(spaceId: number | undefined, connectorId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (msg: MailSendInput) => mailApi.saveDraft(spaceId!, connectorId, msg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
    },
  });
}

/**
 * ADR-158 §P6 — enqueue a delayed send (`/send` + `scheduledAt`). Nothing leaves
 * SMTP now; the worker transmits at the due time. On success we refresh the
 * scheduled queue so the "Отложенные" rail view picks the new row up immediately.
 */
export function useScheduleMail(spaceId: number | undefined, connectorId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ msg, scheduledAt }: { msg: MailSendInput; scheduledAt: string }) =>
      mailApi.scheduleSend(spaceId!, connectorId, msg, scheduledAt),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.scheduled(spaceId) });
    },
  });
}

/**
 * ADR-158 §P6 — the scheduled queue for the "Отложенные" rail view. Polls so the
 * list drains on its own as the worker sends rows (the worker runs every 60s). By
 * default the backend returns pending + sending + failed, soonest-first.
 */
export function useScheduledMail(spaceId: number | undefined) {
  return useQuery<MailScheduled[]>({
    queryKey: keys.scheduled(spaceId),
    queryFn: () => mailApi.scheduled.list(spaceId!),
    enabled: Number.isFinite(spaceId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** ADR-158 §P6 — cancel a still-pending scheduled send; refresh the queue after. */
export function useCancelScheduled(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mailApi.scheduled.cancel(spaceId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.scheduled(spaceId) });
    },
  });
}

/**
 * ADR-158 §P6 — edit a still-pending scheduled send in place (recipients / subject
 * / body / fire time). Refreshes the queue so the "Отложенные" list reflects the
 * new time + preview without a manual refetch.
 */
export function useUpdateScheduled(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, msg, scheduledAt }: { id: number; msg: MailSendInput; scheduledAt: string }) =>
      mailApi.scheduled.update(spaceId!, id, msg, scheduledAt),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.scheduled(spaceId) });
    },
  });
}

/**
 * Mutate a message's flags/placement (PATCH): mark (un)read, star/unstar,
 * archive/trash (folder move). Optimistically patches every cached list the row
 * lives in so the star fills / the row leaves the folder instantly, then
 * reconciles from the server and refreshes the unread counts.
 */
export function useUpdateMessage(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MailPatch }) =>
      mailApi.update(spaceId!, id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['mail', 'messages', spaceId] });
      const snapshots = qc.getQueriesData<MailMessage[]>({
        queryKey: ['mail', 'messages', spaceId],
      });
      for (const [key, list] of snapshots) {
        if (!list) continue;
        const next = list
          .map((m) => (m.id === id ? applyPatch(m, patch) : m))
          // A folder move drops the row out of the folder it's currently listed in.
          .filter((m) => !(m.id === id && 'folder' in patch));
        qc.setQueryData(key, next);
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, list]) => qc.setQueryData(key, list));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
    },
  });
}

/** Merge a PATCH into a cached row for the optimistic update. */
function applyPatch(m: MailMessage, patch: MailPatch): MailMessage {
  return {
    ...m,
    ...(patch.is_read !== undefined ? { read: patch.is_read } : {}),
    ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
    ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
  };
}
