/**
 * useAtomRow — read/update a single atoms_v2 row (ADR-0012 Phase 5 / M4).
 *
 * Atoms (ticket_ref / verification_settings / widget refs / etc.) live in the
 * universal `atoms_v2` table (id 3574). The backend hydrates ticket_ref
 * snapshots on POST/PUT via `validateTicketRefAtom`, so the client just needs
 * to read/write rows and trust the persisted shape.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { ATOMS_V2_TABLE_ID, TICKET_REF_TYPE, type TicketRefAtomPayload } from './types';

export const atomsV2Keys = {
  all: ['atoms-v2'] as const,
  row: (atomId: number) => ['atoms-v2', 'row', atomId] as const,
};

interface RawAtomRow {
  id: number;
  base_id?: string;
  table_id: number;
  data: TicketRefAtomPayload | Record<string, unknown> | string;
  created_at?: string;
  updated_at?: string;
}

interface ParsedAtomRow {
  id: number;
  base_id?: string;
  data: TicketRefAtomPayload | Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

function parseRowData(row: RawAtomRow): ParsedAtomRow {
  let data: TicketRefAtomPayload | Record<string, unknown> = {};
  const raw = row.data;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  } else if (raw && typeof raw === 'object') {
    data = raw as TicketRefAtomPayload | Record<string, unknown>;
  }
  return {
    id: row.id,
    base_id: row.base_id,
    data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Fetch a single atom row from atoms_v2 by row id. */
export function useAtomRow(atomId: number | null | undefined) {
  return useQuery<ParsedAtomRow | null>({
    queryKey: atomId ? atomsV2Keys.row(atomId) : atomsV2Keys.all,
    queryFn: async () => {
      if (!atomId) return null;
      const response = await apiClient.get<{ data: RawAtomRow } | RawAtomRow>(
        `/tables/${ATOMS_V2_TABLE_ID}/rows/${atomId}`,
      );
      const payload = response as unknown as { data?: RawAtomRow } & RawAtomRow;
      const row = payload?.data?.id ? payload.data : (payload?.id ? payload : null);
      if (!row) return null;
      return parseRowData(row as RawAtomRow);
    },
    enabled: Boolean(atomId),
    staleTime: 30_000,
  });
}

interface CreateTicketRefAtomParams {
  widget_ref: number;
  doc_id?: number;
  ticket_id: number;
  mode: TicketRefAtomPayload['props']['mode'];
  display_mode: TicketRefAtomPayload['props']['display_mode'];
}

interface UpdateAtomRowParams {
  atomId: number;
  data: Record<string, unknown>;
}

/** Create / update mutations for atoms_v2 rows. */
export function useAtomMutations(opts?: { isReadOnly?: boolean }) {
  const queryClient = useQueryClient();
  const isReadOnly = opts?.isReadOnly === true;

  const createTicketRefAtom = useMutation({
    mutationFn: async (params: CreateTicketRefAtomParams) => {
      // ADR-0060 P6/P: fail-closed when host widget is read-only.
      if (isReadOnly) {
        throw new Error('DocumentsWidget is read-only — createTicketRefAtom blocked');
      }
      const payload: TicketRefAtomPayload = {
        type: TICKET_REF_TYPE,
        widget_ref: params.widget_ref,
        doc_id: params.doc_id,
        props: {
          ticket_id: params.ticket_id,
          mode: params.mode,
          display_mode: params.display_mode,
        },
      };
      const response = await apiClient.post<{ data: { id: number; base_id?: string } }>(
        `/tables/${ATOMS_V2_TABLE_ID}/rows`,
        { data: payload },
      );
      const result = (response as unknown as { data?: { id: number } }).data
        ?? (response as unknown as { id?: number });
      if (!result?.id) throw new Error('Atom create returned no id');
      return result;
    },
    onSuccess: (result) => {
      if (result?.id) {
        queryClient.invalidateQueries({ queryKey: atomsV2Keys.row(result.id) });
      }
    },
  });

  const updateAtomRow = useMutation({
    mutationFn: async ({ atomId, data }: UpdateAtomRowParams) => {
      if (isReadOnly) {
        throw new Error('DocumentsWidget is read-only — updateAtomRow blocked');
      }
      const response = await apiClient.put<{ success: boolean }>(
        `/tables/${ATOMS_V2_TABLE_ID}/rows/${atomId}`,
        { data },
      );
      return response;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: atomsV2Keys.row(vars.atomId) });
    },
  });

  return {
    createTicketRefAtom: createTicketRefAtom.mutateAsync,
    updateAtomRow: updateAtomRow.mutateAsync,
    isCreating: createTicketRefAtom.isPending,
    isUpdating: updateAtomRow.isPending,
  };
}

/** Type guard for ticket_ref atoms. */
export function isTicketRefAtomPayload(
  data: TicketRefAtomPayload | Record<string, unknown> | undefined | null,
): data is TicketRefAtomPayload {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.type !== TICKET_REF_TYPE) return false;
  const props = d.props as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object') return false;
  return typeof props.ticket_id === 'number';
}
