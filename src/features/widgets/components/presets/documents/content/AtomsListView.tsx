import { useMemo, useState, useEffect } from 'react';
import { Atom, Loader2, X, Code, Link, BookOpen, Lightbulb, FileCode, Component, Workflow, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { ViewModeToggle } from '@/shared/components/ui/ViewModeToggle';
import { useDocumentsContext } from '../DocumentsContext';
import type { DocumentAtom } from '../../../../types/documents.types';

// Atom type icons
const ATOM_TYPE_ICONS: Record<string, React.ReactNode> = {
  endpoint: <Link className="w-4 h-4" />,
  concept: <Lightbulb className="w-4 h-4" />,
  howto: <BookOpen className="w-4 h-4" />,
  code: <Code className="w-4 h-4" />,
  reference: <FileCode className="w-4 h-4" />,
  component: <Component className="w-4 h-4" />,
  hook: <Workflow className="w-4 h-4" />,
  content: <Atom className="w-4 h-4" />,
};

const ATOM_TYPE_COLORS: Record<string, string> = {
  endpoint: 'bg-green-500/20 text-green-400 border-green-500/30',
  concept: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  howto: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  code: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  reference: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  component: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  hook: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  content: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

/**
 * AtomsListView - Central view showing all atoms from all documents
 * Displays atoms in a list with search from toolbar
 */
export function AtomsListView() {
  const ctx = useDocumentsContext();
  const [atoms, setAtoms] = useState<DocumentAtom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingAtom, setEditingAtom] = useState<DocumentAtom | null>(null);
  const [editForm, setEditForm] = useState({ key: '', title: '', content: '', type: 'content' });
  const [isSaving, setIsSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Use atoms from context (already loaded via useAtoms hook)
  useEffect(() => {
    if (ctx.allAtoms) {
      setAtoms(ctx.allAtoms);
      setIsLoading(ctx.isLoadingAtoms);
    } else {
      setIsLoading(false);
    }
  }, [ctx.allAtoms, ctx.isLoadingAtoms]);

  // Collect atom IDs referenced by the selected document's items
  const documentAtomIds = useMemo(() => {
    if (ctx.selectedDocumentId == null) return null;
    const ids = new Set<number>();
    for (const item of ctx.items) {
      if (item.atom_ref != null) {
        const n = Number(item.atom_ref);
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    return ids;
  }, [ctx.selectedDocumentId, ctx.items]);

  // Filter by document scope + search from toolbar
  const filteredAtoms = useMemo(() => {
    let result = atoms;

    // Document scope filter — only atoms referenced by the selected document
    if (documentAtomIds) {
      result = result.filter((atom: DocumentAtom) => documentAtomIds.has(Number(atom.id)));
    }

    const query = ctx.atomsPanelSearchQuery.toLowerCase();
    if (query) {
      result = result.filter((atom: DocumentAtom) =>
        (atom.title?.toLowerCase().includes(query)) ||
        (atom.key?.toLowerCase().includes(query)) ||
        (atom.content?.toLowerCase().includes(query))
      );
    }

    return result;
  }, [atoms, ctx.atomsPanelSearchQuery, documentAtomIds]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Centered content like documents view */}
      <div className={cn(
        "mx-auto p-6",
        ctx.atomsDisplayMode === 'cards' ? 'max-w-6xl' : 'max-w-4xl'
      )}>
        {/* Header - compact */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-primary)]">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <Atom className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">
              {ctx.selectedDocumentId != null
                ? `Атомы документа «${ctx.selectedDocument?.name || 'Документ'}»`
                : 'Библиотека атомов'}
            </h1>
            <p className="text-xs text-[var(--text-tertiary)]">
              {ctx.selectedDocumentId != null
                ? `${filteredAtoms.length} привязанны${filteredAtoms.length === 1 ? 'й' : 'х'} (из ${atoms.length} в базе)`
                : `${atoms.length} атомов в базе`}
            </p>
          </div>
          {/* View mode toggle */}
          <ViewModeToggle
            value={ctx.atomsDisplayMode}
            onChange={ctx.setAtomsDisplayMode}
            size="sm"
          />
        </div>

        {/* Atoms list/cards */}
        {filteredAtoms.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-tertiary)]">
            <Atom className="w-12 h-12 mx-auto mb-4 opacity-30" />
            {ctx.selectedDocumentId != null && atoms.length > 0 ? (
              <>
                <p className="text-base mb-2">Нет привязанных атомов</p>
                <p className="text-sm max-w-sm mx-auto">
                  В этом документе пока нет привязанных атомов. Превратите текстовые блоки в атомы.
                </p>
              </>
            ) : atoms.length === 0 ? (
              <>
                <p className="text-base mb-2">Нет атомов</p>
                <p className="text-sm max-w-sm mx-auto">Создайте атомы из текстовых блоков документов</p>
              </>
            ) : (
              <>
                <p className="text-base mb-2">Ничего не найдено</p>
                <p className="text-sm max-w-sm mx-auto">Попробуйте изменить поисковый запрос</p>
              </>
            )}
          </div>
        ) : ctx.atomsDisplayMode === 'cards' ? (
          /* Cards view - full data with all info */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredAtoms.map((atom: DocumentAtom) => {
              const typeColor = ATOM_TYPE_COLORS[atom.type || 'content'] || ATOM_TYPE_COLORS.content;
              const typeIcon = ATOM_TYPE_ICONS[atom.type || 'content'] || ATOM_TYPE_ICONS.content;
              
              return (
                <div
                  key={atom.id}
                  onClick={() => {
                    setEditingAtom(atom);
                    setEditForm({
                      key: atom.key || '',
                      title: atom.title || '',
                      content: atom.content || '',
                      type: atom.type || 'content',
                    });
                  }}
                  className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-purple-500/30 transition-all cursor-pointer overflow-hidden"
                >
                  {/* Header */}
                  <div className="p-4 pb-2">
                    <div className="flex items-start gap-3">
                      <div className={cn("p-2 rounded-lg", typeColor)}>
                        {typeIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm mb-1">
                          {atom.title || 'Без названия'}
                        </h3>
                        <span className="text-[10px] text-purple-400 font-mono">#{atom.key}</span>
                      </div>
                    </div>
                  </div>

                  {/* Content preview */}
                  {atom.content && (
                    <div className="px-4 pb-3">
                      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] text-xs leading-relaxed max-h-32 overflow-hidden">
                        <MarkdownPreview content={atom.content.slice(0, 300) + (atom.content.length > 300 ? '...' : '')} />
                      </div>
                    </div>
                  )}

                  {/* Footer with tags */}
                  <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                    <span className={cn("px-2 py-0.5 rounded border text-[9px] font-medium", typeColor)}>
                      {atom.type || 'content'}
                    </span>
                    {atom.http_method && (
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[9px] font-medium",
                        atom.http_method === 'GET' ? 'bg-green-500/20 text-green-400' :
                        atom.http_method === 'POST' ? 'bg-blue-500/20 text-blue-400' :
                        atom.http_method === 'PUT' ? 'bg-yellow-500/20 text-yellow-400' :
                        atom.http_method === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      )}>
                        {atom.http_method}
                      </span>
                    )}
                    {atom.content_en && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[9px]">EN</span>}
                    {atom.content_ru && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px]">RU</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view - compact with accordion */
          <div className="space-y-2">
            {filteredAtoms.map((atom: DocumentAtom) => {
              const typeColor = ATOM_TYPE_COLORS[atom.type || 'content'] || ATOM_TYPE_COLORS.content;
              const typeIcon = ATOM_TYPE_ICONS[atom.type || 'content'] || ATOM_TYPE_ICONS.content;
              const isExpanded = expandedIds.has(atom.id);
              
              return (
                <div
                  key={atom.id}
                  className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-purple-500/30 transition-all overflow-hidden"
                >
                  {/* Collapsed header row */}
                  <div
                    onClick={() => {
                      setExpandedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(atom.id)) {
                          next.delete(atom.id);
                        } else {
                          next.add(atom.id);
                        }
                        return next;
                      });
                    }}
                    className="p-3 cursor-pointer group flex items-center gap-3"
                  >
                    {/* Expand arrow */}
                    <button className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    
                    {/* Type icon */}
                    <div className={cn("p-1.5 rounded", typeColor)}>
                      {typeIcon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-purple-400 font-mono">#{atom.key}</span>
                        <h3 className="font-medium text-sm truncate">
                          {atom.title || 'Без названия'}
                        </h3>
                      </div>
                    </div>

                    {/* Right side - type badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      {atom.http_method && (
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[9px] font-medium",
                          atom.http_method === 'GET' ? 'bg-green-500/20 text-green-400' :
                          atom.http_method === 'POST' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        )}>
                          {atom.http_method}
                        </span>
                      )}
                      <span className={cn("px-2 py-0.5 rounded border text-[9px] font-medium", typeColor)}>
                        {atom.type || 'content'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingAtom(atom);
                          setEditForm({
                            key: atom.key || '',
                            title: atom.title || '',
                            content: atom.content || '',
                            type: atom.type || 'content',
                          });
                        }}
                        className="p-1.5 rounded hover:bg-purple-500/20 transition-colors opacity-0 group-hover:opacity-100 text-purple-400"
                        title="Редактировать"
                      >
                        <Atom className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border-secondary)] p-4">
                      {/* Full content */}
                      {atom.content && (
                        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] text-sm leading-relaxed mb-3">
                          <MarkdownPreview content={atom.content} />
                        </div>
                      )}
                      
                      {/* Metadata */}
                      <div className="flex items-center gap-3 flex-wrap text-[10px] text-[var(--text-tertiary)]">
                        {atom.content_en && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">EN локализация</span>}
                        {atom.content_ru && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">RU локализация</span>}
                        {atom.api_path && <span className="font-mono text-green-400">{atom.api_path}</span>}
                        {atom.tags && atom.tags.length > 0 && (
                          <span>Теги: {atom.tags.join(', ')}</span>
                        )}
                      </div>
                      
                      {/* Edit button */}
                      <button
                        onClick={() => {
                          setEditingAtom(atom);
                          setEditForm({
                            key: atom.key || '',
                            title: atom.title || '',
                            content: atom.content || '',
                            type: atom.type || 'content',
                          });
                        }}
                        className="mt-3 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-colors"
                      >
                        Редактировать атом
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Atom Edit Modal */}
      {editingAtom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingAtom(null)}>
          <div
            className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
              <div className="flex items-center gap-3">
                <Atom className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold">Редактирование атома</h2>
              </div>
              <button
                onClick={() => setEditingAtom(null)}
                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
              <div>
                <label className="block text-sm font-medium mb-1.5">Ключ</label>
                <input
                  type="text"
                  value={editForm.key}
                  onChange={e => setEditForm(f => ({ ...f, key: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
                  placeholder="atom-key"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Название</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
                  placeholder="Название атома"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Тип</label>
                <select
                  value={editForm.type}
                  onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
                >
                  <option value="content">content</option>
                  <option value="endpoint">endpoint</option>
                  <option value="concept">concept</option>
                  <option value="howto">howto</option>
                  <option value="code">code</option>
                  <option value="reference">reference</option>
                  <option value="component">component</option>
                  <option value="hook">hook</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Содержимое</label>
                <textarea
                  value={editForm.content}
                  onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm font-mono resize-y"
                  placeholder="Markdown содержимое..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <button
                onClick={() => setEditingAtom(null)}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  setIsSaving(true);
                  try {
                    await ctx.updateAtom({
                      atomId: editingAtom.id,
                      data: {
                        key: editForm.key,
                        title: editForm.title,
                        content: editForm.content,
                        type: editForm.type,
                      },
                    });
                    ctx.refreshAtoms();
                    setEditingAtom(null);
                  } catch (error) {
                    logger.error('Failed to update atom:', error);
                    alert('Ошибка сохранения');
                  } finally {
                    setIsSaving(false);
                  }
                }}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 disabled:opacity-50"
              >
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
