import { Bot, Layers, Atom, Eye, FileStack, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';

export function ToolbarViewActions() {
  const ctx = useDocumentsContext();

  return (
    <>
      {/* AI Agents button — hidden in read-only (ADR-0060 P6/P) */}
      {!ctx.isReadOnly && ctx.selectedDocument && (
        <button
          onClick={() => ctx.setShowAgentsModal(true)}
          className={cn(
            "p-1.5 rounded-md",
            "hover:bg-[var(--bg-tertiary)]"
          )}
          title="Настройка AI агентов"
        >
          <Bot className="w-4 h-4" />
        </button>
      )}

      {/* Structure mode toggle - hidden in read-only (ADR-105) */}
      {!ctx.isReadOnly && ctx.selectedDocument && (
        <button
          onClick={() => ctx.setStructureMode(!ctx.structureMode)}
          className={cn(
            "p-1.5 rounded-md",
            ctx.structureMode
              ? "bg-[var(--color-primary-500)] text-white"
              : "hover:bg-[var(--bg-tertiary)]"
          )}
          title={ctx.structureMode ? "Режим просмотра" : "Режим структуры"}
        >
          <Layers className="w-4 h-4" />
        </button>
      )}

      {/* Atoms panel toggle */}
      {ctx.selectedDocument && (
        <button
          onClick={() => {
            if (ctx.rightPanelMode === 'atoms' && ctx.rightPanelOpen) {
              ctx.setRightPanelOpen(false);
            } else {
              ctx.setRightPanelMode('atoms');
              ctx.setRightPanelOpen(true);
              ctx.setSelectedItemId(null);
            }
          }}
          className={cn(
            "p-1.5 rounded-md flex items-center gap-1",
            ctx.rightPanelMode === 'atoms' && ctx.rightPanelOpen
              ? "bg-purple-500 text-white"
              : "hover:bg-[var(--bg-tertiary)]"
          )}
          title="Панель атомов"
        >
          <Atom className="w-4 h-4" />
        </button>
      )}

      {/* View mode switcher */}
      {ctx.selectedDocument && (
        <div className="flex items-center rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] overflow-hidden">
          <button
            onClick={() => ctx.setPreviewMode('strip')}
            className={cn(
              "px-2 py-1 text-xs transition-colors",
              ctx.previewMode === 'strip' ? 'bg-[var(--color-primary-500)] text-white' : 'hover:bg-[var(--bg-secondary)]'
            )}
            title="С рамкой"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="4" x2="8" y2="20" />
              <line x1="16" y1="4" x2="16" y2="20" />
            </svg>
          </button>
          <button
            onClick={() => ctx.setPreviewMode('pages')}
            className={cn(
              "px-2 py-1 text-xs transition-colors",
              ctx.previewMode === 'pages' ? 'bg-[var(--color-primary-500)] text-white' : 'hover:bg-[var(--bg-secondary)]'
            )}
            title="Постранично"
          >
            <FileStack className="w-4 h-4" />
          </button>
          <button
            onClick={() => ctx.setPreviewMode('none')}
            className={cn(
              "px-2 py-1 text-xs transition-colors",
              ctx.previewMode === 'none' ? 'bg-[var(--color-primary-500)] text-white' : 'hover:bg-[var(--bg-secondary)]'
            )}
            title="Без рамки"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content Scale */}
      {ctx.selectedDocument && (
        <div className="flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] px-1" title="Масштаб текста (влияет на печать)">
          <span className="text-[10px] text-[var(--text-tertiary)] px-1">Текст</span>
          <button
            onClick={() => ctx.setContentScale(Math.max(50, ctx.contentScale - 10))}
            className="p-1 hover:bg-[var(--bg-secondary)] rounded"
            title="Уменьшить текст"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs min-w-[36px] text-center">{ctx.contentScale}%</span>
          <button
            onClick={() => ctx.setContentScale(Math.min(150, ctx.contentScale + 10))}
            className="p-1 hover:bg-[var(--bg-secondary)] rounded"
            title="Увеличить текст"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
