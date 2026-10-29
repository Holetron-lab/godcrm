/**
 * DocumentTile — A4-proportioned document preview tile (grid surface).
 *
 * Thin wrapper around DocumentTileView that pulls live data + handlers
 * from DocumentsContext. Identical look to the chat-side DocumentRowAtom
 * (both render the same DocumentTileView).
 */

import { useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useDocumentsContext } from '../DocumentsContext';
import { useDocumentChat } from '../useDocumentChat';
import { useAIChat } from '@/features/ai-chat';
import { publicApi } from '@/features/public/publicApi';
import { DocumentTileView } from './DocumentTileView';
import { downloadDocumentAsMarkdown } from './documentDownload';
import type { DocumentRegistryItem } from '../../../../types/documents.types';

export interface DocumentTileProps {
  doc: DocumentRegistryItem;
  onClick: () => void;
  isSelected?: boolean;
}

export function DocumentTile({ doc, onClick, isSelected }: DocumentTileProps) {
  const ctx = useDocumentsContext();
  const { openDocumentChat } = useDocumentChat();
  const { attachRowToMessage } = useAIChat();
  const isPublic = ctx.dataSource === 'public';

  const [preview, setPreview] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);

  useEffect(() => {
    const tableId = doc.content_table_id || doc.table_id;
    const canFetchPrivate = !isPublic && !!tableId;
    const canFetchPublic = isPublic && !!ctx.publicSlug && !!ctx.widgetId && !!doc.slug;
    if (!canFetchPrivate && !canFetchPublic) {
      setPreview('');
      setIsLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setIsLoadingPreview(true);

    (async () => {
      try {
        const lang = ctx.currentLanguage || 'en';
        let rows: Array<{ data?: Record<string, unknown> }> = [];

        if (canFetchPublic) {
          const response = await publicApi.getWidgetDocumentAtoms(
            ctx.publicSlug as string,
            ctx.widgetId as number,
            doc.slug,
          );
          if (cancelled) return;
          rows = response.data?.rows || [];
        } else {
          const response = await apiClient.get<{ data?: { rows?: Array<Record<string, unknown>> } }>(
            `/tables/${tableId}/rows?limit=10`,
          );
          if (cancelled) return;
          rows = response.data?.rows || [];
        }

        const textItems = rows
          .filter((row) => {
            const data = row.data as Record<string, unknown> | undefined;
            return data?.level === 'text' || (!data?.level && data?.content);
          })
          .slice(0, 3);

        const previewText = textItems
          .map((row) => {
            const data = row.data as Record<string, unknown> | undefined;
            return (data?.[`content_${lang}`] || data?.content_en || data?.content_ru || data?.content || '') as string;
          })
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 400);

        setPreview(previewText);
      } catch (error) {
        if (!cancelled) {
          logger.debug('Failed to load document preview:', error);
          setPreview('');
        }
      } finally {
        if (!cancelled) setIsLoadingPreview(false);
      }
    })();

    return () => { cancelled = true; };
  }, [doc.content_table_id, doc.table_id, doc.slug, ctx.currentLanguage, isPublic, ctx.publicSlug, ctx.widgetId]);

  return (
    <DocumentTileView
      doc={doc}
      preview={preview}
      isLoadingPreview={isLoadingPreview}
      statusOptions={ctx.statusOptions}
      currentStatus={ctx.resolveStatus(doc)}
      isSelected={isSelected}
      onClick={onClick}
      onStatusChange={isPublic ? undefined : async (newId) => {
        const opt = ctx.statusOptions.find(o => o.id === newId);
        if (!opt || !ctx.registryTableId) return;
        try {
          await tablesApi.updateRow(String(ctx.registryTableId), String(doc.id), {
            status_id: opt.id,
            status: opt.slug,
          });
          ctx.refresh();
        } catch (error) {
          // ADR-0011: surface VerificationGateModal on 409/403 from row guards.
          // Mirrors StatusDropdown.tsx — grid tile was previously silent.
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
                tableId: String(ctx.registryTableId),
                rowId: String(doc.id),
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
          logger.error('Failed to update status:', error);
          showToast(err?.message || 'Не удалось сменить статус документа', 'error');
        }
      }}
      onChat={isPublic ? undefined : () => openDocumentChat(doc.id, doc.name || '')}
      onAttach={isPublic ? undefined : () => attachRowToMessage({
        table_id: ctx.registryTableId || 0,
        row_id: doc.id,
        table_name: 'Documents',
        table_icon: '📄',
        row_title: doc.name || `#${doc.id}`,
      })}
      onDownload={() => downloadDocumentAsMarkdown(doc, ctx.currentLanguage || 'en')}
      onSettings={isPublic ? undefined : () => {
        ctx.setEditingDocumentId(doc.id);
        ctx.setShowEditDocumentModal(true);
      }}
      onConfirmDelete={isPublic ? undefined : async () => {
        try {
          await ctx.deleteDocument({ documentId: doc.id, deleteTable: true });
        } catch (error) {
          logger.error('Failed to delete document:', error);
        }
      }}
    />
  );
}
