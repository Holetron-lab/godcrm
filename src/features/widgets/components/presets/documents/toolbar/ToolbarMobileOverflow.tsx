import { useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import {
  MoreHorizontal,
  RefreshCw,
  Layers,
  ZoomIn,
  ZoomOut,
  Download,
  Copy,
  Printer,
  Bot,
  Trash2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { printDocument } from './utils/printDocument';
import { copyDocumentAsMarkdown, exportDocumentAsMarkdown } from './utils/markdownExport';

export function ToolbarMobileOverflow() {
  const ctx = useDocumentsContext();
  const [open, setOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
    <div className="relative" ref={overflowRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="More options"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[200px]">
          {/* Refresh */}
          <button
            onClick={() => { ctx.refresh(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>

          {ctx.selectedDocument && (
            <>
              {/* Structure mode toggle */}
              {!ctx.isReadOnly && (
                <button
                  onClick={() => { ctx.setStructureMode(!ctx.structureMode); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
                >
                  <Layers className="w-4 h-4" /> {ctx.structureMode ? 'View mode' : 'Structure mode'}
                </button>
              )}

              {/* View mode */}
              <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] uppercase">View mode</div>
              <div className="flex items-center gap-1 px-4 pb-2">
                {(['strip', 'pages', 'none'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { ctx.setPreviewMode(mode); setOpen(false); }}
                    className={cn(
                      "px-3 py-2 rounded text-xs min-h-[44px]",
                      ctx.previewMode === mode
                        ? 'bg-[var(--color-primary-500)] text-white'
                        : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)]'
                    )}
                  >
                    {mode === 'strip' ? 'Strip' : mode === 'pages' ? 'Pages' : 'Clean'}
                  </button>
                ))}
              </div>

              {/* Scale controls */}
              <div className="px-4 py-2 flex items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)]">Scale</span>
                <button
                  onClick={() => ctx.setContentScale(Math.max(50, ctx.contentScale - 10))}
                  className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs min-w-[36px] text-center">{ctx.contentScale}%</span>
                <button
                  onClick={() => ctx.setContentScale(Math.min(150, ctx.contentScale + 10))}
                  className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>

              <div className="border-t border-[var(--border-primary)] my-1" />

              {/* Export */}
              <button
                onClick={() => { handleExportMarkdown(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
              >
                <Download className="w-4 h-4" /> Export MD
              </button>

              {/* Copy MD */}
              <button
                onClick={() => { handleCopyAsMarkdown(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
              >
                <Copy className="w-4 h-4" /> Copy as MD
              </button>

              {/* Print */}
              <button
                onClick={() => { handlePrint(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
              >
                <Printer className="w-4 h-4" /> Print
              </button>

              {/* AI Agents — hidden in read-only (ADR-0060 P6/P) */}
              {!ctx.isReadOnly && (
                <button
                  onClick={() => { ctx.setShowAgentsModal(true); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--bg-tertiary)] min-h-[44px]"
                >
                  <Bot className="w-4 h-4" /> AI Agents
                </button>
              )}

              {/* Delete */}
              {!ctx.isReadOnly && (
                <>
                  <div className="border-t border-[var(--border-primary)] my-1" />
                  <button
                    onClick={() => { handleDeleteDocument(); setOpen(false); }}
                    disabled={ctx.isDeleting}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-500/10 min-h-[44px]"
                  >
                    <Trash2 className="w-4 h-4" /> Delete document
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
