import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useTablesStore } from '../store/tablesStore';
import { refreshRowFromServer } from './useRowMutations';

/** Envelope pushed by GET /tables/:id/events (backend/services/realtime/rowEvents.js). */
export interface RowChangeEvent {
  table_id: number;
  row_id: string;
  action: 'created' | 'updated' | 'deleted';
  source: string;
  ts: string;
}

const ROW_EVENT_TYPES = ['row.created', 'row.updated', 'row.deleted'] as const;
/** Automations fire several writes per edit; one flush per burst keeps refetches down. */
const FLUSH_MS = 150;

export const parseRowChangeEvent = (raw: unknown): RowChangeEvent | null => {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const { table_id, row_id, action, source, ts } = parsed as Partial<RowChangeEvent>;
    if (!Number.isInteger(table_id) || row_id === undefined || row_id === null) return null;
    if (action !== 'created' && action !== 'updated' && action !== 'deleted') return null;
    return { table_id: table_id as number, row_id: String(row_id), action, source: String(source ?? ''), ts: String(ts ?? '') };
  } catch {
    return null;
  }
};

/**
 * Keeps the store-fed grid of `tableId` in sync with writes made elsewhere:
 * other users, agents and automations. Updated rows that are loaded are
 * refetched one by one and merged; created/deleted rows invalidate the page
 * query so ordering and pagination come from the server.
 */
export const useTableRowsLiveSync = (tableId: string | null, enabled = true) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tableId || !enabled || typeof EventSource === 'undefined') return;

    const token = getAccessToken();
    // EventSource cannot send headers; the cookie session covers browsers, the
    // query token covers the desktop app (same contract as /bdd/events).
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
    let source: EventSource;
    try {
      source = new EventSource(`${getBaseUrlSync()}/tables/${tableId}/events${tokenQs}`, { withCredentials: true });
    } catch (err) {
      logger.debug('[useTableRowsLiveSync] failed to open EventSource', err);
      return;
    }

    const updatedIds = new Set<string>();
    let listChanged = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const ids = [...updatedIds];
      updatedIds.clear();
      const refetchList = listChanged;
      listChanged = false;
      if (refetchList) {
        // A page refetch replaces every loaded row, so per-row fetches are moot.
        void queryClient.invalidateQueries({ queryKey: ['rows', tableId] });
        return;
      }
      const loaded = useTablesStore.getState().rows[tableId] ?? [];
      for (const id of ids) {
        if (!loaded.some((row) => String(row.id) === id)) continue;
        refreshRowFromServer(tableId, id).catch((err) => {
          logger.debug('[useTableRowsLiveSync] row refresh failed', { id, err });
        });
      }
    };

    const onEvent = (event: Event) => {
      const change = parseRowChangeEvent((event as MessageEvent).data);
      if (!change || String(change.table_id) !== tableId) return;
      if (change.action === 'updated') updatedIds.add(change.row_id);
      else listChanged = true;
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };

    for (const type of ROW_EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onerror = () => {
      // The browser reconnects by itself while the server is reachable.
      logger.debug('[useTableRowsLiveSync] stream error', { tableId });
    };

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [tableId, enabled, queryClient]);
};
