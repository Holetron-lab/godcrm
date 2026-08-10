/**
 * Atom Picker Modal - Select an existing atom to link to a document element
 * 
 * @see TASK-009-DOCUMENTS-ATOMS-TRANSLATIONS.md
 */

import { useState, useMemo } from 'react';
import { X, Search, Atom, Link2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useDocumentsContext } from './DocumentsContext';
import type { DocumentAtom } from '../../../hooks/useAtoms';

interface AtomPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (atomId: number, atom: DocumentAtom) => void;
  excludeAtomIds?: number[];
}

export function AtomPicker({ isOpen, onClose, onSelect, excludeAtomIds = [] }: AtomPickerProps) {
  const ctx = useDocumentsContext();
  const [search, setSearch] = useState('');
  
  // Filter atoms by search and exclude already linked ones
  const filteredAtoms = useMemo(() => {
    const excluded = new Set(excludeAtomIds);
    let atoms = ctx.allAtoms.filter(a => !excluded.has(a.id));
    
    if (search.trim()) {
      const q = search.toLowerCase();
      atoms = atoms.filter(atom =>
        atom.key?.toLowerCase().includes(q) ||
        atom.title?.toLowerCase().includes(q) ||
        atom.content?.toLowerCase().includes(q) ||
        atom.type?.toLowerCase().includes(q)
      );
    }
    
    return atoms;
  }, [ctx.allAtoms, search, excludeAtomIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-purple-500" />
            <span className="font-medium">Выбрать атом</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-400">
              {ctx.allAtoms.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Search */}
        <div className="px-6 py-3 border-b border-[var(--border-primary)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Поиск атомов по названию, ключу или содержимому..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>
        
        {/* Atoms List */}
        <div className="flex-1 overflow-y-auto p-4">
          {ctx.isLoadingAtoms ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm">Загрузка атомов...</p>
            </div>
          ) : filteredAtoms.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <Atom className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {search ? 'Атомы не найдены' : 'Нет доступных атомов'}
              </p>
              <p className="text-xs mt-1">
                {search ? 'Попробуйте изменить поиск' : 'Создайте атомы в разделе "Все атомы"'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAtoms.map(atom => (
                <button
                  key={atom.id}
                  onClick={() => onSelect(atom.id, atom)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border transition-colors",
                    "border-[var(--border-primary)] hover:border-purple-500 hover:bg-purple-500/5"
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {atom.title || atom.key || 'Без названия'}
                      </div>
                      {atom.key && (
                        <div className="text-xs text-[var(--text-tertiary)] font-mono mt-0.5">
                          key: {atom.key}
                        </div>
                      )}
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono flex-shrink-0 bg-purple-500/20 text-purple-400">
                      ⚛ ATOM #{atom.id}
                    </span>
                  </div>
                  
                  {/* Type badge */}
                  {atom.type && (
                    <div className="mt-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/20 text-blue-400">
                        {atom.type}
                      </span>
                      {atom.http_method && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/20 text-green-400">
                          {atom.http_method} {atom.http_path}
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* Content preview */}
                  {atom.content && (
                    <div className="mt-2 p-2 rounded bg-[var(--bg-tertiary)] text-[11px] leading-relaxed max-h-20 overflow-hidden">
                      <MarkdownPreview content={atom.content.slice(0, 150) + (atom.content.length > 150 ? '...' : '')} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <span className="text-xs text-[var(--text-tertiary)]">
            {filteredAtoms.length} из {ctx.allAtoms.length} атомов
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
