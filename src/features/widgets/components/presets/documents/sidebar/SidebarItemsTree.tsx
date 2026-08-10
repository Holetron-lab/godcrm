import React from 'react';
import { ChevronRight, FileText, MessageCircle, Paperclip, Puzzle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAIChat } from '@/features/ai-chat';
import { useDocumentsContext } from '../DocumentsContext';
import { useDocumentChat } from '../useDocumentChat';
import { CATEGORY_ICONS } from '../../../../types/documents.types';
import { StatusDropdown } from './StatusDropdown';

interface SidebarItemsTreeProps {
  showInlineWidgets: boolean;
  setShowInlineWidgets: (next: boolean) => void;
}

const INDENT_BY_LEVEL: Record<string, number> = {
  h2: 12,
  h3: 24,
  text: 36,
  divider: 12,
  page_break: 12,
  image: 36,
  widget: 24,
};

function getIndent(level: string): number {
  return INDENT_BY_LEVEL[level] ?? 8;
}

export function SidebarItemsTree({ showInlineWidgets, setShowInlineWidgets }: SidebarItemsTreeProps) {
  const ctx = useDocumentsContext();
  const { openDocumentChat } = useDocumentChat();
  const { attachRowToMessage } = useAIChat();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-[var(--border-secondary)]">
        <button
          onClick={() => {
            ctx.setSelectedDocumentId(null);
            ctx.setShowDocumentsGrid(false);
            ctx.setTicketsViewMode(false);
            ctx.setAtomsViewMode(false);
            if (ctx.isMobile) ctx.setMobileSidebarOpen(false);
          }}
          className={cn(
            'flex-1 flex items-center gap-2 p-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
            ctx.isMobile && 'min-h-[44px]'
          )}
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Все документы
        </button>
        <div className="flex items-center gap-1 pr-2">
          <button
            onClick={() => setShowInlineWidgets(!showInlineWidgets)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
              showInlineWidgets
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            )}
            title={showInlineWidgets ? 'Скрыть виджеты в дереве' : 'Показать виджеты в дереве'}
          >
            <Puzzle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => ctx.setShowAllElements(!ctx.showAllElements)}
            className={cn(
              'p-1.5 text-xs rounded transition-colors',
              ctx.showAllElements
                ? 'text-[var(--color-primary-400)] bg-[var(--color-primary-500)]/10'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'
            )}
            title={ctx.showAllElements ? 'Скрыть детали' : 'Показать все'}
          >
            {ctx.showAllElements ? '−' : '+'}
          </button>
        </div>
      </div>

      {ctx.selectedDocument && (
        <div className="p-3 border-b border-[var(--border-secondary)]">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-xl">{ctx.selectedDocument.icon || '📄'}</span>
              <StatusDropdown
                doc={ctx.selectedDocument}
                registryTableId={ctx.registryTableId}
                onUpdate={ctx.refresh}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{ctx.selectedDocument.name}</div>
              {ctx.selectedDocument.category && (
                <div className="text-xs text-[var(--text-tertiary)]">
                  {CATEGORY_ICONS[ctx.selectedDocument.category] || '📁'} {ctx.selectedDocument.category}
                </div>
              )}
            </div>
            {ctx.dataSource !== 'public' && (
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDocumentChat(ctx.selectedDocumentId!, ctx.selectedDocument?.name || '');
                  }}
                  className="w-6 h-6 rounded-full bg-blue-500/20 hover:bg-blue-500/30 flex items-center justify-center text-blue-400 transition-colors"
                  title="Open document chat"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    attachRowToMessage({
                      table_id: ctx.registryTableId || 0,
                      row_id: ctx.selectedDocumentId!,
                      table_name: 'Documents',
                      table_icon: '📄',
                      row_title: ctx.selectedDocument?.name || `#${ctx.selectedDocumentId}`,
                    });
                  }}
                  className="w-6 h-6 rounded-full bg-green-500/20 hover:bg-green-500/30 flex items-center justify-center text-green-400 transition-colors"
                  title="Attach to message"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {ctx.items
          .filter(item =>
            ctx.showAllElements ||
            item.id === ctx.selectedItemId ||
            (showInlineWidgets && item.level === 'widget') ||
            (item.level !== 'text' &&
              item.level !== 'divider' &&
              item.level !== 'page_break' &&
              item.level !== 'image' &&
              item.level !== 'widget')
          )
          .map((item) => {
            let hasAtomChild = false;
            let hasWidgetChild = false;
            if (item.level === 'h2' || item.level === 'h3') {
              const itemIdx = ctx.items.indexOf(item);
              for (let i = itemIdx + 1; i < ctx.items.length; i++) {
                const child = ctx.items[i];
                if (child.level === 'h1' || child.level === 'h2' || child.level === 'h3') break;
                if (child.level === 'text' && child.atom_ref) {
                  let closestHeaderIdx = -1;
                  for (let j = i - 1; j >= 0; j--) {
                    if (ctx.items[j].level === 'h2' || ctx.items[j].level === 'h3') {
                      closestHeaderIdx = j;
                      break;
                    }
                  }
                  if (closestHeaderIdx === itemIdx) {
                    hasAtomChild = true;
                  }
                }
                if (child.level === 'widget') {
                  let closestHeaderIdx = -1;
                  for (let j = i - 1; j >= 0; j--) {
                    if (ctx.items[j].level === 'h2' || ctx.items[j].level === 'h3') {
                      closestHeaderIdx = j;
                      break;
                    }
                  }
                  if (closestHeaderIdx === itemIdx) {
                    hasWidgetChild = true;
                  }
                }
              }
            }

            const indent = getIndent(item.level);

            return (
              <React.Fragment key={item.id}>
                <div
                  className={cn(
                    'flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-sm border-l-2',
                    ctx.selectedItemId === item.id
                      ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)] border-[var(--color-primary-500)]'
                      : 'hover:bg-[var(--bg-tertiary)] border-transparent',
                    item.level === 'h2' && 'font-medium',
                    item.level === 'text' && 'text-[var(--text-secondary)]',
                    item.level === 'widget' && 'text-cyan-400'
                  )}
                  style={{ marginLeft: indent }}
                  onClick={() => {
                    ctx.setSelectedItemId(item.id);
                    const element = document.getElementById(`item-${item.id}`);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  {item.level === 'divider' ? (
                    <div className="flex-1 h-[1px] bg-[var(--border-secondary)]" />
                  ) : item.level === 'page_break' ? (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 h-[1px] border-t border-dashed border-orange-500" />
                      <span className="text-[10px] text-orange-500">PAGE</span>
                      <div className="flex-1 h-[1px] border-t border-dashed border-orange-500" />
                    </div>
                  ) : item.level === 'image' ? (
                    <span className="truncate flex-1 text-[var(--text-tertiary)]">
                      🖼️ {item.content?.substring(0, 20) || 'Изображение'}
                    </span>
                  ) : item.level === 'widget' ? (
                    <span className="truncate flex-1 flex items-center gap-1.5">
                      <Puzzle className="w-3 h-3 shrink-0" />
                      <span className="truncate">
                        {item.content?.substring(0, 30) || `Widget #${item.widget_ref ?? item.id}`}
                      </span>
                    </span>
                  ) : (
                    <span className="truncate flex-1">
                      {item.content?.substring(0, 30) || 'Без названия'}
                    </span>
                  )}

                  {hasAtomChild && (
                    <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400">⚛</span>
                  )}

                  {showInlineWidgets && hasWidgetChild && (
                    <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-cyan-500/20 text-cyan-400">🧩</span>
                  )}

                  {item.level === 'text' && item.atom_ref && (
                    <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400">⚛</span>
                  )}

                  {ctx.showAllElements && (
                    <span className={cn(
                      'px-1 py-0.5 rounded text-[10px] uppercase',
                      item.level === 'h1' ? 'bg-purple-500/20 text-purple-400' :
                      item.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
                      item.level === 'h3' ? 'bg-green-500/20 text-green-400' :
                      item.level === 'divider' ? 'bg-gray-500/20 text-gray-400' :
                      item.level === 'page_break' ? 'bg-orange-500/20 text-orange-400' :
                      item.level === 'image' ? 'bg-pink-500/20 text-pink-400' :
                      item.level === 'widget' ? 'bg-cyan-500/20 text-cyan-400' :
                      'bg-gray-500/20 text-gray-400'
                    )}>
                      {item.level === 'divider' ? 'DIV' : item.level === 'page_break' ? 'PAGE' : item.level === 'image' ? 'IMG' : item.level === 'widget' ? 'WIDGET' : item.level}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}

        {ctx.items.length === 0 && (
          <div className="text-center py-8 text-[var(--text-tertiary)]">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Документ пуст</p>
          </div>
        )}
      </div>
    </div>
  );
}
