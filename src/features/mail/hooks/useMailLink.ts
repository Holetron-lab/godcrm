import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { mailApi } from '../api/mailApi';
import type { MailMessage } from '../types';

/**
 * ADR-158 §P2 — hooks for the manual "attach mail to a CRM row" flow.
 *
 * `linked_table_id/linked_row_id` already ride on every MailMessage (toMailMessage);
 * these hooks resolve *which* table a person-link should target and perform the
 * PUT …/link write. Mutation invalidation mirrors the label hooks so the reader
 * chip + list refresh for free.
 */

/** One space's linkable tables (person/contact registry lives among them). */
export interface SpaceTable {
  id: number;
  key: string;
  display_name: string;
}

/**
 * Which table a mail→person link points at, for this space. The resolver
 * (`/access/space/:id/tables`) already surfaces the System-Data "users" table as
 * `default_table_id`, so linking works with zero config; an operator can override
 * the target per space (persisted client-side, same idiom as the mail label/view
 * prefs in `labelPrefs.ts`) without overloading `access_control.usersTableId`.
 */
const overrideKey = (spaceId: number) => `mail:people-table:${spaceId}`;

function readOverride(spaceId: number | undefined): number | null {
  if (!Number.isFinite(spaceId)) return null;
  const raw = localStorage.getItem(overrideKey(spaceId!));
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function useMailPeopleTable(spaceId: number | undefined) {
  const [override, setOverrideState] = useState<number | null>(() => readOverride(spaceId));

  const tablesQuery = useQuery({
    queryKey: ['mail', 'people-tables', spaceId],
    queryFn: async () => {
      const r = await apiClient.request<{
        data: { tables: SpaceTable[]; default_table_id: number | null };
      }>(`/access/space/${spaceId}/tables`);
      return r.data ?? { tables: [], default_table_id: null };
    },
    enabled: Number.isFinite(spaceId),
    staleTime: 60_000,
  });

  const setTableId = useCallback(
    (id: number) => {
      if (!Number.isFinite(spaceId)) return;
      localStorage.setItem(overrideKey(spaceId!), String(id));
      setOverrideState(id);
    },
    [spaceId]
  );

  const tables = tablesQuery.data?.tables ?? [];
  // Override wins, but only if it still resolves to a real table in this space.
  const validOverride = override != null && tables.some((t) => t.id === override) ? override : null;
  const tableId = validOverride ?? tablesQuery.data?.default_table_id ?? null;

  return { tableId, tables, setTableId, isLoading: tablesQuery.isLoading };
}

/** Link (or, with `target: null`, unlink) the open message. Optimistic-free — the
 *  write is fast and we invalidate the same keys the label mutations do. */
export function useLinkMessage(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation<
    MailMessage,
    Error,
    { msgId: string; target: { tableId: number; rowId: number } | null }
  >({
    mutationFn: ({ msgId, target }) => mailApi.link(spaceId!, msgId, target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
      qc.invalidateQueries({ queryKey: ['mail', 'message', spaceId] });
    },
  });
}

/** Best-effort display name for the row a message is linked to (reader chip). Falls
 *  back to `#<rowId>` while loading or when no obvious name column exists. */
export function useLinkedRowLabel(message: MailMessage): string | null {
  const { linkedTableId, linkedRowId } = message;
  const { data } = useQuery({
    queryKey: ['mail', 'linked-row', linkedTableId, linkedRowId],
    queryFn: () => tablesApi.getRow(String(linkedTableId), String(linkedRowId)),
    enabled: linkedTableId != null && linkedRowId != null,
    staleTime: 30_000,
  });

  if (linkedRowId == null) return null;
  const row = (data ?? {}) as { data?: Record<string, unknown> };
  const d = (row.data && typeof row.data === 'object' ? row.data : row) as Record<string, unknown>;
  const named = ['name', 'full_name', 'fio', 'title', 'email'].map((k) => d[k]).find(Boolean);
  const firstString = named ?? Object.values(d).find((v) => typeof v === 'string' && v.trim());
  return firstString ? String(firstString) : `#${linkedRowId}`;
}
