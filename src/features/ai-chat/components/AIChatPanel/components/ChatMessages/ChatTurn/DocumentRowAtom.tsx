/**
 * DocumentRowAtom — T-141688 / ADR-0031 §Y / WP-22 (documents preset).
 *
 * Renders a single row from a chat `row_reference` attachment using the
 * exact DocumentTileView from the documents widget. Self-contained:
 * fetches its own registry row, status dictionary, and content preview.
 *
 * Lazy-mounts via IntersectionObserver — a card scrolled out of view never
 * fires its first SELECT.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useInView } from '@/features/widgets/components/presets/documents/content/useInView';
import { DocumentTileView } from '@/features/widgets/components/presets/documents/content/DocumentTileView';
import { DocumentViewerModal } from '@/features/widgets/components/presets/documents/content/DocumentViewerModal';
import { downloadDocumentAsMarkdown } from '@/features/widgets/components/presets/documents/content/documentDownload';
import type { DocumentRegistryItem, StatusOption } from '@/features/widgets/types/documents.types';

type ColumnConfigShape = {
  relation?: { enabled?: boolean; tableId?: string | number };
  relatedTableId?: string | number;
  target_table_id?: number | string;
};

interface ColumnInfoAPI {
  name: string;
  display_name?: string;
  column_type: string;
  // The /tables/:id/columns endpoint already parses config server-side,
  // but older clients/tests may receive it as a raw JSON string. Handle both.
  config?: ColumnConfigShape | string | null;
}

interface RegistryRow {
  id: number;
  data: Record<string, unknown>;
}

export interface DocumentRowAtomProps {
  tableId: number;
  rowId: number;
  rowReference: {
    table_id: number;
    row_id: number;
    table_name: string;
    table_icon?: string;
    row_title?: string;
  };
  onOpenDetail: () => void;
  onOpenEdit: () => void;
  /** Open the row's own task chat thread (chat-bubble icon). */
  onOpenTaskChat: () => void;
  onAttachToMessage: () => void;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseConfig(raw: ColumnConfigShape | string | null | undefined): ColumnConfigShape | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) as ColumnConfigShape;
  } catch {
    return null;
  }
}

export function DocumentRowAtom({
  tableId,
  rowId,
  rowReference,
  onOpenDetail,
  onOpenEdit,
  onOpenTaskChat,
  onAttachToMessage,
}: DocumentRowAtomProps) {
  const { ref: ioRef, isInView } = useInView<HTMLDivElement>({ rootMargin: '200px 0px', enabled: true });
  const enabled = isInView && tableId > 0 && rowId > 0;
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const rowQuery = useQuery<RegistryRow>({
    queryKey: ['document-row-atom', tableId, rowId],
    queryFn: async () => {
      const resp = await apiClient.get<{ row?: RegistryRow; data?: { row?: RegistryRow } }>(`/tables/${tableId}/rows/${rowId}`);
      const r = (resp as unknown as { row?: RegistryRow }).row
        ?? (resp as unknown as { data?: { row?: RegistryRow } }).data?.row;
      if (!r) throw new Error('Row not found');
      return r;
    },
    enabled,
    staleTime: 30_000,
  });

  const columnsQuery = useQuery<ColumnInfoAPI[]>({
    queryKey: ['document-row-atom-columns', tableId],
    queryFn: async () => {
      const resp = await apiClient.get<{ data: ColumnInfoAPI[] }>(`/tables/${tableId}/columns`);
      return resp.data || [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const statusesTableId = useMemo<number | null>(() => {
    const col = (columnsQuery.data || []).find(c => c.name === 'status_id' || c.name === 'status');
    const cfg = parseConfig(col?.config);
    if (!cfg) return null;
    const id = cfg.target_table_id ?? (cfg.relation?.enabled ? cfg.relation.tableId : undefined) ?? cfg.relatedTableId;
    const n = id != null ? Number(id) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [columnsQuery.data]);

  const statusesQuery = useQuery<StatusOption[]>({
    queryKey: ['doc-statuses-for-atom', statusesTableId],
    queryFn: async () => {
      const resp = await apiClient.get<{ data: { rows: Array<{ id: number; data: Record<string, unknown> }> } }>(
        `/tables/${statusesTableId}/rows?limit=200`,
      );
      const rows = resp.data?.rows || [];
      return rows.map(r => {
        const d = (r.data && typeof r.data === 'object') ? r.data : {};
        return {
          id: r.id,
          slug: String(d.slug ?? ''),
          label: String(d.label ?? d.slug ?? `#${r.id}`),
          icon: d.icon ? String(d.icon) : undefined,
          color: d.color ? String(d.color) : undefined,
        };
      });
    },
    enabled: enabled && !!statusesTableId,
    staleTime: 5 * 60_000,
  });

  // Build a DocumentRegistryItem from the chat-fetched row + reference.
  const data = rowQuery.data?.data || {};
  const doc = useMemo<DocumentRegistryItem>(() => ({
    id: rowId,
    name: asString(data.name) || rowReference.row_title || `#${rowId}`,
    slug: asString(data.slug) || '',
    table_id: asNumber(data.table_id) || 0,
    content_table_id: asNumber(data.content_table_id) ?? asNumber(data.table_id),
    icon: asString(data.icon) || rowReference.table_icon || '📄',
    description: asString(data.description),
    category: asString(data.category),
    status: asString(data.status) as DocumentRegistryItem['status'],
    status_id: asNumber(data.status_id),
  }), [rowId, rowReference, data]);

  const currentStatus = useMemo<StatusOption | undefined>(() => {
    const opts = statusesQuery.data || [];
    if (doc.status_id != null) {
      const byId = opts.find(o => o.id === doc.status_id);
      if (byId) return byId;
    }
    if (doc.status) return opts.find(o => o.slug === doc.status);
    return undefined;
  }, [statusesQuery.data, doc.status_id, doc.status]);

  // Preview — first 3 text items from the content table.
  const contentTableId = doc.content_table_id ?? null;
  const [preview, setPreview] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  useEffect(() => {
    if (!enabled || !contentTableId) {
      setPreview('');
      return;
    }
    let cancelled = false;
    setIsLoadingPreview(true);
    apiClient
      .get<{ data: { rows: Array<{ data: Record<string, unknown> }> } }>(`/tables/${contentTableId}/rows?limit=10`)
      .then(resp => {
        if (cancelled) return;
        const rows = resp.data?.rows || [];
        const textItems = rows
          .filter(row => {
            const d = (row.data && typeof row.data === 'object') ? row.data : {};
            return d.level === 'text' || (!d.level && d.content);
          })
          .slice(0, 3);
        const text = textItems
          .map(row => {
            const d = (row.data && typeof row.data === 'object') ? row.data : {};
            return (d.content_en || d.content_ru || d.content || '') as string;
          })
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 400);
        setPreview(text);
      })
      .catch(err => {
        logger.debug('DocumentRowAtom preview load failed', { err });
        if (!cancelled) setPreview('');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });
    return () => { cancelled = true; };
  }, [enabled, contentTableId]);

  const isLoading = enabled && (rowQuery.isLoading || columnsQuery.isLoading);
  const isError = rowQuery.isError;

  if (!isInView || isLoading) {
    return (
      <div ref={ioRef} className="w-full max-w-[360px]">
        <DocumentRowAtomSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div ref={ioRef} className="w-full rounded-lg bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)] px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">Не удалось загрузить документ #{rowId}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={ioRef} className="w-full max-w-[360px]">
      <DocumentTileView
        doc={doc}
        preview={preview}
        isLoadingPreview={isLoadingPreview}
        statusOptions={statusesQuery.data || []}
        currentStatus={currentStatus}
        enforceAspectRatio={false}
        onClick={() => setIsViewerOpen(true)}
        onStatusChange={async (newId) => {
          const opts = statusesQuery.data || [];
          const opt = opts.find(o => o.id === newId);
          if (!opt) return;
          try {
            await tablesApi.updateRow(String(tableId), String(rowId), {
              status_id: opt.id,
              status: opt.slug,
            });
            await rowQuery.refetch();
          } catch (error) {
            // ADR-0011: surface VerificationGateModal on 409/403 from row guards.
            // Mirrors StatusDropdown.tsx — chat surface was previously silent.
            const err = error as Error & { code?: string; details?: Record<string, unknown> };
            if (
              (err?.code === 'VERIFICATION_REQUIRED' || err?.code === 'VERIFICATION_IMMUTABLE') &&
              err.details &&
              typeof err.details === 'object'
            ) {
              const d = err.details as {
                verification_column_id?: number;
                verification_column_name?: string;
                offending_column?: string;
                offending_value?: string;
              };
              if (d.verification_column_id && d.verification_column_name) {
                useTablesStore.getState().openVerificationGate({
                  tableId: String(tableId),
                  rowId: String(rowId),
                  verificationColumnId: d.verification_column_id,
                  verificationColumnName: d.verification_column_name,
                  offendingColumn: d.offending_column ?? 'status_id',
                  offendingValue: d.offending_value ?? String(opt.id),
                  offendingPrevValue: doc.status_id ?? null,
                  reason: err.code === 'VERIFICATION_IMMUTABLE' ? 'immutable' : 'required',
                  message: err.message || 'Verification required',
                });
                return;
              }
            }
            logger.error('Failed to update document status:', error);
            showToast(err?.message || 'Не удалось сменить статус документа', 'error');
          }
        }}
        onChat={onOpenTaskChat}
        onAttach={onAttachToMessage}
        onDownload={() => downloadDocumentAsMarkdown(doc, 'en')}
        onSettings={onOpenEdit}
      />
      <div className="mt-1 px-1 text-[10px] text-[var(--text-tertiary)] truncate">
        {rowReference.table_name} #{rowId}
      </div>
      {isViewerOpen && (
        <DocumentViewerModal
          doc={doc}
          registryTableId={tableId}
          currentStatus={currentStatus}
          onClose={() => setIsViewerOpen(false)}
        />
      )}
    </div>
  );
}

function DocumentRowAtomSkeleton() {
  return (
    <div
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden animate-pulse"
      style={{ aspectRatio: '1 / 1.414' }}
    >
      <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
        <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-800 flex-shrink-0" />
        <div className="flex-1 h-4 rounded bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 w-11/12" />
        <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 w-2/3" />
        <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 w-9/12" />
      </div>
    </div>
  );
}

export default DocumentRowAtom;
