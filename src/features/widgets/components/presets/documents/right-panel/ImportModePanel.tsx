import { useMemo } from 'react';
import { X, Atom, FileText, Settings, Trash2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { LEVEL_LABELS, LEVEL_ICONS } from '../../../../types/documents.types';
import type { SectionTreeNodeV4 } from '../../../../utils/parseMarkdownToAtoms';
import { flattenSectionTree, transliterate } from './utils';
import { TYPE_OPTIONS } from './constants';

export function ImportModePanel() {
  const ctx = useDocumentsContext();

  const flatSections = useMemo(
    () => (ctx.isCreatingMode ? flattenSectionTree(ctx.importTree) : []),
    [ctx.isCreatingMode, ctx.importTree],
  );

  const importSection = useMemo(() => {
    if (!ctx.isCreatingMode || ctx.activePreviewOrder === null) return null;
    return flatSections.find(s => s.order === ctx.activePreviewOrder) || null;
  }, [ctx.isCreatingMode, ctx.activePreviewOrder, flatSections]);

  if (!ctx.rightPanelOpen || ctx.activePreviewOrder === null) {
    return null;
  }

  // Document title editor (-1)
  if (ctx.activePreviewOrder === -1) {
    return (
      <div className="absolute right-0 top-0 bottom-0 z-20 w-[320px] flex flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-400" />
            <span className="font-medium text-sm">Название документа</span>
          </div>
          <button onClick={() => ctx.setRightPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded text-xs font-mono uppercase bg-purple-500/20 text-purple-400">H1</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Название</label>
            <input
              type="text"
              value={ctx.newDocName}
              onChange={(e) => ctx.setNewDocName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  // Document description editor (-2)
  if (ctx.activePreviewOrder === -2) {
    return (
      <div className="absolute right-0 top-0 bottom-0 z-20 w-[320px] flex flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <span className="font-medium text-sm">Описание документа</span>
          </div>
          <button onClick={() => ctx.setRightPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded text-xs font-mono uppercase bg-gray-500/20 text-gray-400">DESC</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Описание</label>
            <textarea
              value={ctx.newDocDescription}
              onChange={(e) => ctx.setNewDocDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm resize-y"
            />
          </div>
        </div>
      </div>
    );
  }

  if (!importSection) {
    return null;
  }

  const atomState = ctx.atomSections[importSection.order] || { enabled: false, key: '', title: '' };

  const generateKey = (title: string, order: number) => {
    const base = transliterate(title || 'section');
    return `${base}-${order}`;
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-[320px] flex flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-[var(--text-tertiary)]" />
          <span className="font-medium text-sm">Настройки секции</span>
        </div>
        <div className="flex items-center gap-2">
          {importSection.level === 'text' && atomState.enabled && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 flex items-center gap-1">
              <Atom className="w-3 h-3" />
            </span>
          )}
          <button onClick={() => ctx.setRightPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Level Badge + Order */}
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-2 py-1 rounded text-xs font-mono uppercase",
            importSection.level === 'h1' ? 'bg-purple-500/20 text-purple-400' :
            importSection.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
            importSection.level === 'h3' ? 'bg-green-500/20 text-green-400' :
            'bg-gray-500/20 text-gray-400'
          )}>
            {LEVEL_ICONS[importSection.level] || '📝'} {LEVEL_LABELS[importSection.level] || importSection.level}
          </span>
          <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <span>order:</span>
            <input
              type="number"
              value={importSection.order}
              onChange={(e) => {
                const newOrder = parseInt(e.target.value) || 0;
                ctx.setImportTree(prev => {
                  const updateOrder = (nodes: SectionTreeNodeV4[]): SectionTreeNodeV4[] => {
                    return nodes.map(n => {
                      if (n.section.order === importSection.order) {
                        return { ...n, section: { ...n.section, order: newOrder } };
                      }
                      if (n.children) {
                        return { ...n, children: updateOrder(n.children) };
                      }
                      return n;
                    });
                  };
                  return updateOrder(prev);
                });
                ctx.setActivePreviewOrder(newOrder);
              }}
              className="w-12 px-1 py-0.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-center"
            />
          </div>
        </div>

        {/* Type selector */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Тип секции</label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm cursor-pointer"
            defaultValue={importSection.level === 'text' ? 'reference' : 'heading'}
          >
            {TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Content — headings only */}
        {importSection.level !== 'divider' && importSection.level !== 'text' && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Заголовок</label>
            <input
              type="text"
              value={importSection.content || ''}
              onChange={(e) => {
                ctx.setEditingImportData({ content: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm"
            />
          </div>
        )}

        {/* Atom toggle for text */}
        {importSection.level === 'text' && (
          <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Atom className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium">Атом</span>
              </div>
              <button
                onClick={() => {
                  const newEnabled = !atomState.enabled;
                  let parentTitle = '';
                  for (let i = flatSections.findIndex(s => s.order === importSection.order) - 1; i >= 0; i--) {
                    if (flatSections[i].level === 'h3' || flatSections[i].level === 'h2' || flatSections[i].level === 'h1') {
                      parentTitle = flatSections[i].content || '';
                      break;
                    }
                  }
                  ctx.setAtomSections(prev => ({
                    ...prev,
                    [importSection.order]: {
                      ...prev[importSection.order],
                      enabled: newEnabled,
                      key: newEnabled ? (atomState.key || generateKey(parentTitle, importSection.order)) : atomState.key,
                      title: newEnabled ? (atomState.title || parentTitle) : atomState.title
                    }
                  }));
                }}
                className={cn(
                  "px-2 py-1 rounded text-xs",
                  atomState.enabled ? "bg-purple-500 text-white" : "bg-[var(--bg-tertiary)]"
                )}
              >
                {atomState.enabled ? 'Вкл' : 'Выкл'}
              </button>
            </div>

            {atomState.enabled && (
              <div className="space-y-2 mt-3">
                <div>
                  <label className="block text-[10px] uppercase text-purple-400 mb-1">base_id</label>
                  <input
                    type="text"
                    value={atomState.key}
                    onChange={(e) => ctx.setAtomSections(prev => ({
                      ...prev,
                      [importSection.order]: { ...prev[importSection.order], key: transliterate(e.target.value) }
                    }))}
                    className="w-full px-2 py-1 rounded text-xs bg-[var(--bg-primary)] border border-purple-500/30 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-purple-400 mb-1">Заголовок</label>
                  <input
                    type="text"
                    value={atomState.title}
                    onChange={(e) => ctx.setAtomSections(prev => ({
                      ...prev,
                      [importSection.order]: { ...prev[importSection.order], title: e.target.value }
                    }))}
                    className="w-full px-2 py-1 rounded text-xs bg-[var(--bg-primary)] border border-purple-500/30"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <button
          onClick={() => {
            ctx.setActivePreviewOrder(null);
            ctx.setRightPanelOpen(false);
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-red-500 bg-red-500/10 hover:bg-red-500/20 text-sm"
        >
          <Trash2 className="w-4 h-4" /> Удалить секцию
        </button>
      </div>
    </div>
  );
}
