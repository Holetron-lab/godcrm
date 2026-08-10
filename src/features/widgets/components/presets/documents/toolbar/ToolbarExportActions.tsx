import { logger } from '@/shared/utils/logger';
import {
  RefreshCw,
  Download,
  Printer,
  Copy,
  Check,
  Trash2,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useDocumentsContext } from '../DocumentsContext';
import { printDocument } from './utils/printDocument';
import { copyDocumentAsMarkdown, exportDocumentAsMarkdown } from './utils/markdownExport';

export function ToolbarExportActions() {
  const ctx = useDocumentsContext();

  const handleExportMarkdown = () => {
    if (!ctx.selectedDocument) return;
    exportDocumentAsMarkdown(ctx.selectedDocument, ctx.items);
  };

  const handlePrint = () => {
    if (!ctx.selectedDocument) return;
    printDocument({
      document: ctx.selectedDocument,
      items: ctx.items,
      contentScale: ctx.contentScale,
    });
  };

  const handleCopyAsMarkdown = async () => {
    if (!ctx.selectedDocument) return;
    await copyDocumentAsMarkdown(ctx.selectedDocument, ctx.items, ctx.setCopied);
  };

  const handleDeleteDocument = async () => {
    if (!ctx.selectedDocumentId || !ctx.selectedDocument) return;

    const docName = ctx.selectedDocument.name;
    if (!confirm(`Удалить документ "${docName}"? Это действие нельзя отменить.`)) return;

    try {
      await ctx.deleteDocument({ documentId: ctx.selectedDocumentId });
      ctx.setSelectedDocumentId(null);
      ctx.setSelectedItemId(null);
      ctx.setRightPanelOpen(false);
    } catch (err) {
      logger.error('Delete document failed:', err);
    }
  };

  return (
    <>
      <button onClick={ctx.refresh} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]" title="Обновить">
        <RefreshCw className="w-4 h-4" />
      </button>

      {ctx.selectedDocument && (
        <>
          <div className="w-px h-4 bg-[var(--border-primary)]" />
          <button onClick={handleExportMarkdown} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]" title="Экспорт MD">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={handlePrint} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]" title="Печать">
            <Printer className="w-4 h-4" />
          </button>
          <button onClick={handleCopyAsMarkdown} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]" title="Копировать MD">
            {ctx.copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
          {/* Delete document - hidden in read-only (ADR-105) */}
          {!ctx.isReadOnly && (
            <button
              onClick={handleDeleteDocument}
              disabled={ctx.isDeleting}
              className="p-1.5 rounded-md hover:bg-red-500/10 text-red-500"
              title="Удалить документ"
            >
              {ctx.isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          )}

          {/* View Scale Slider - far right */}
          <div className="w-px h-4 bg-[var(--border-primary)] ml-2" />
          <div className="flex items-center gap-2 ml-2" title="Масштаб просмотра (не влияет на печать)">
            <ZoomOut className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="range"
              min="50"
              max="150"
              step="10"
              value={ctx.viewScale}
              onChange={(e) => ctx.setViewScale(Number(e.target.value))}
              className="w-20 h-1 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-[var(--color-primary-500)]"
            />
            <ZoomIn className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <span className="text-xs text-[var(--text-tertiary)] min-w-[32px]">{ctx.viewScale}%</span>
          </div>
        </>
      )}
    </>
  );
}
