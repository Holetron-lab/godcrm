import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { TableNode } from '../../types/schema-editor.types';

const MAX_RESULTS = 15;

/**
 * Toolbar search: find a table by name, key or #id and center it on the canvas.
 * The input opens inline in the toolbar row; only the result list drops below it.
 * Picking a result fires the same `schema-editor:focus-table` event as the nav tree "Show on canvas".
 */
export const SchemaSearch = () => {
  const { t } = useLanguage();
  const nodes = useSchemaEditorStore((state) => state.nodes);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const idQuery = q.startsWith('#') ? q.slice(1) : q;
    return nodes
      .filter((n): n is TableNode => n.type === 'tableNode')
      .filter((n) =>
        (n.data.displayName || '').toLowerCase().includes(q) ||
        n.data.name.toLowerCase().includes(q) ||
        (idQuery !== '' && String(n.data.tableId).startsWith(idQuery))
      )
      .slice(0, MAX_RESULTS);
  }, [nodes, query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handleOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const pick = (tableId: number) => {
    window.dispatchEvent(new CustomEvent('schema-editor:focus-table', { detail: { tableId } }));
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      pick(results[activeIndex].data.tableId);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={open ? 'schema-search-input' : undefined}
        className={`p-2 rounded-md transition-colors ${
          open
            ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
        }`}
        title={t('schemaEditor.search.title')}
      >
        <Search className="w-4 h-4" />
      </button>

      {open && (
        <input
          id="schema-search-input"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('schemaEditor.search.placeholder')}
          aria-label={t('schemaEditor.search.title')}
          aria-controls="schema-search-results"
          className="h-8 w-52 px-2 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        />
      )}

      {open && query.trim() !== '' && (
        <ul
          id="schema-search-results"
          role="listbox"
          aria-label={t('schemaEditor.search.title')}
          className="absolute left-0 top-full mt-1 z-[120] w-80 max-h-72 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl p-1"
        >
          {results.length === 0 && (
            <li className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{t('schemaEditor.search.noResults')}</li>
          )}
          {results.map((node, index) => (
            <li key={node.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(node.data.tableId)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                  index === activeIndex ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'
                }`}
              >
                <span className="flex-shrink-0">{node.data.icon || '📋'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--text-primary)]">{node.data.displayName || node.data.name}</span>
                  <span className="block truncate text-[10px] font-mono text-[var(--text-tertiary)]">
                    #{node.data.tableId} • {node.data.name}{node.data.projectName ? ` • ${node.data.projectName}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
