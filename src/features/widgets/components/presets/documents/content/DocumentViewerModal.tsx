/**
 * DocumentViewerModal — read-only document viewer for chat row attachments.
 *
 * Loads all rows from the document's content table, merges them into Markdown,
 * and renders them inside the shared `FilePreviewModal` so users get the same
 * theme/zoom/fullscreen/download toolbar they're used to from image and file
 * previews. Adds an "Open in module" header action that resolves the host
 * widget by registry table id and navigates to it.
 */

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { FilePreviewModal } from '@/features/files/components/FilePreviewModal';
import type { DocumentRegistryItem, StatusOption } from '../../../../types/documents.types';

interface ContentRow {
  data?: Record<string, unknown>;
}

export interface DocumentViewerModalProps {
  doc: DocumentRegistryItem;
  registryTableId: number;
  currentStatus?: StatusOption;
  language?: string;
  onClose: () => void;
}

export function DocumentViewerModal({
  doc,
  registryTableId,
  currentStatus,
  language = 'en',
  onClose,
}: DocumentViewerModalProps) {
  const navigate = useNavigate();
  const contentTableId = doc.content_table_id || doc.table_id;
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [widgetId, setWidgetId] = useState<number | null>(null);

  useEffect(() => {
    if (!contentTableId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    apiClient
      .get<{ data?: { rows?: ContentRow[] } }>(`/tables/${contentTableId}/rows?limit=5000`)
      .then((resp) => {
        if (cancelled) return;
        setRows(resp.data?.rows || []);
      })
      .catch((err) => {
        logger.error('DocumentViewerModal load failed', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [contentTableId]);

  useEffect(() => {
    if (!registryTableId) return;
    let cancelled = false;
    apiClient
      .get<{ data?: { widget_id?: number } }>(`/widgets/by-registry-table/${registryTableId}`)
      .then((resp) => {
        if (cancelled) return;
        const id = resp.data?.widget_id;
        if (typeof id === 'number' && Number.isFinite(id)) setWidgetId(id);
      })
      .catch(() => {
        // 404 = no widget hosts this table; button just won't render.
      });
    return () => { cancelled = true; };
  }, [registryTableId]);

  const markdown = useMemo(() => {
    const header: string[] = [`# ${doc.icon || '📄'} ${doc.name}`, ''];
    const meta: string[] = [];
    if (currentStatus) meta.push(`**Status:** ${currentStatus.icon ? `${currentStatus.icon} ` : ''}${currentStatus.label}`);
    if (doc.category) meta.push(`**Category:** ${doc.category}`);
    if (meta.length) {
      header.push(meta.join(' · '), '');
    }
    if (doc.description) {
      header.push(`> ${doc.description.replace(/\n/g, '\n> ')}`, '');
    }
    header.push('---', '');

    if (rows.length === 0) {
      return header.join('\n') + (isLoading ? '' : '_Документ пуст_');
    }
    const sorted = [...rows].sort((a, b) => {
      const ao = (a.data || {}).order;
      const bo = (b.data || {}).order;
      const an = typeof ao === 'number' ? ao : 0;
      const bn = typeof bo === 'number' ? bo : 0;
      return an - bn;
    });
    const lines: string[] = [...header];
    for (const row of sorted) {
      const item = (row.data || {}) as Record<string, unknown>;
      const content = (
        item[`content_${language}`] ||
        item.content_en ||
        item.content_ru ||
        item.content ||
        ''
      ) as string;
      const level = item.level as string;
      if (level === 'h1') lines.push(`# ${content}`, '');
      else if (level === 'h2') lines.push(`## ${content}`, '');
      else if (level === 'h3') lines.push(`### ${content}`, '');
      else if (level === 'divider') lines.push('---', '');
      else if (content) lines.push(content, '');
    }
    return lines.join('\n');
  }, [rows, language, doc, currentStatus, isLoading]);

  const handleOpenInModule = () => {
    if (!widgetId || !doc.slug) return;
    onClose();
    navigate(`/widgets/${widgetId}?doc=${encodeURIComponent(doc.slug)}`);
  };

  const extraActions = widgetId != null && doc.slug ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleOpenInModule(); }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-blue-500 text-white hover:bg-blue-600 transition-colors"
      title="Открыть в модуле документов"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">В модуль</span>
    </button>
  ) : null;

  return (
    <FilePreviewModal
      isOpen
      onClose={onClose}
      fileName={doc.name}
      fileType="markdown"
      inlineContent={isLoading ? '' : markdown}
      extraHeaderActions={extraActions}
    />
  );
}

export default DocumentViewerModal;
