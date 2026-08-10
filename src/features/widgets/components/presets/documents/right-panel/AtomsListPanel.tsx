import { useMemo } from 'react';
import { X, Atom, Search, Plus } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useDocumentsContext } from '../DocumentsContext';

const TAB_LABELS = {
  'all-atoms': 'Все атомы',
  'doc-atoms': 'Атомы док.',
  'text-blocks': 'Текст',
};

export function AtomsListPanel() {
  const ctx = useDocumentsContext();

  const textBlocks = useMemo(
    () => ctx.items.filter(item => item.level === 'text'),
    [ctx.items],
  );
  const atomItems = useMemo(
    () => ctx.items.filter(item => item.atom_ref != null),
    [ctx.items],
  );
  // Text blocks converted to atoms — same predicate as atomItems (preserved from original).
  const textWithAtomRef = atomItems;

  const displayItems = useMemo(() => {
    const query = ctx.atomsPanelSearchQuery.toLowerCase();
    const filterBySearch = (items: typeof ctx.items) => {
      if (!query) return items;
      return items.filter(item =>
        (item.content?.toLowerCase().includes(query)) ||
        (item.atom_title?.toLowerCase().includes(query)) ||
        (item.atom_ref?.toString().toLowerCase().includes(query))
      );
    };

    const filterAtomsBySearch = (atoms: typeof ctx.allAtoms) => {
      if (!query) return atoms;
      return atoms.filter(atom =>
        (atom.content?.toLowerCase().includes(query)) ||
        (atom.title?.toLowerCase().includes(query)) ||
        (atom.key?.toLowerCase().includes(query))
      );
    };

    switch (ctx.atomsPanelTab) {
      case 'text-blocks':
        return filterBySearch(textBlocks);
      case 'doc-atoms':
        return filterBySearch([...atomItems, ...textWithAtomRef]);
      case 'all-atoms':
        return filterAtomsBySearch(ctx.allAtoms);
      default:
        return [];
    }
  }, [ctx.atomsPanelSearchQuery, ctx.atomsPanelTab, ctx.items, ctx.allAtoms, textBlocks, atomItems, textWithAtomRef]);

  const totalCount = ctx.atomsPanelTab === 'text-blocks'
    ? textBlocks.length
    : ctx.atomsPanelTab === 'doc-atoms'
      ? atomItems.length + textWithAtomRef.length
      : ctx.allAtoms.length;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-[320px] flex flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <Atom className="w-4 h-4 text-purple-400" />
          <span className="font-medium text-sm">Атомы</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-400">
            {totalCount}
          </span>
        </div>
        <button
          onClick={() => ctx.setRightPanelOpen(false)}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-primary)]">
        {(['all-atoms', 'doc-atoms', 'text-blocks'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => ctx.setAtomsPanelTab(tab)}
            className={cn(
              "flex-1 px-2 py-2 text-[10px] font-medium transition-colors",
              ctx.atomsPanelTab === tab
                ? "text-purple-400 border-b-2 border-purple-500 bg-purple-500/5"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-[var(--border-primary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Поиск..."
            value={ctx.atomsPanelSearchQuery}
            onChange={(e) => ctx.setAtomsPanelSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs"
          />
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto p-2">
        {displayItems.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-tertiary)]">
            <Atom className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {totalCount === 0
                ? ctx.atomsPanelTab === 'text-blocks'
                  ? 'Нет текстовых блоков'
                  : 'Нет атомов в документе'
                : 'Ничего не найдено'}
            </p>
            {ctx.atomsPanelTab !== 'text-blocks' && (
              <p className="text-xs mt-1">
                Добавьте атом через + в тулбаре
              </p>
            )}
          </div>
        ) : ctx.atomsPanelTab === 'all-atoms' ? (
          <div className="space-y-1">
            {(displayItems as typeof ctx.allAtoms).map(atom => (
              <div
                key={atom.id}
                className="p-2 rounded-lg border border-transparent hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="cursor-pointer">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 text-xs text-[var(--text-primary)] truncate">
                      {atom.title || atom.key || 'Без названия'}
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono flex-shrink-0 bg-purple-500/20 text-purple-400">
                      ⚛ ATOM
                    </span>
                  </div>

                  {atom.key && (
                    <div className="mt-1 text-[10px] text-[var(--text-tertiary)] font-mono truncate">
                      key: {atom.key}
                    </div>
                  )}

                  {atom.type && (
                    <div className="mt-1">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/20 text-blue-400">
                        {atom.type}
                      </span>
                    </div>
                  )}

                  {atom.content && (
                    <div className="mt-1.5 p-1.5 rounded bg-[var(--bg-tertiary)] text-[11px] leading-relaxed max-h-24 overflow-hidden">
                      <MarkdownPreview content={atom.content.slice(0, 200)} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {(displayItems as typeof ctx.items).map(item => {
              const isAtom = item.level === 'atom';
              const hasAtomRef = item.level === 'text' && item.atom_ref;
              const isTextBlock = item.level === 'text' && !item.atom_ref;

              const displayTitle = (isAtom || hasAtomRef)
                ? (item.atom_title || item.atom_ref || 'Без названия')
                : (item.content?.replace(/[#*_`\[\]()>-]/g, '').trim().slice(0, 60) || 'Без содержимого');

              return (
                <div
                  key={item.id}
                  className={cn(
                    "p-2 rounded-lg border transition-colors",
                    ctx.selectedItemId === item.id
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-transparent hover:bg-[var(--bg-tertiary)]"
                  )}
                >
                  <div
                    onClick={() => {
                      ctx.setSelectedItemId(item.id);
                      ctx.setRightPanelMode('settings');
                      ctx.setRightPanelOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 text-xs text-[var(--text-primary)] truncate">
                        {displayTitle}
                      </div>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[9px] font-mono flex-shrink-0",
                        isAtom ? "bg-purple-500/20 text-purple-400" :
                        hasAtomRef ? "bg-green-500/20 text-green-400" :
                        "bg-gray-500/20 text-gray-400"
                      )}>
                        {isAtom ? '⚛ ATOM' : hasAtomRef ? '📌 REF' : 'TXT'}
                      </span>
                    </div>

                    {(item.atom_ref || hasAtomRef) && (
                      <div className="mt-1 text-[10px] text-[var(--text-tertiary)] font-mono truncate">
                        #{item.atom_ref}
                      </div>
                    )}

                    {item.content && (
                      <div className="mt-1.5 p-1.5 rounded bg-[var(--bg-tertiary)] text-[11px] leading-relaxed">
                        <MarkdownPreview content={item.content} />
                      </div>
                    )}
                  </div>

                  {!ctx.isReadOnly && isTextBlock && ctx.atomsPanelTab === 'text-blocks' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.setConvertToAtomItem(item);
                        ctx.setShowConvertToAtomModal(true);
                      }}
                      className="mt-1.5 w-full px-2 py-1 rounded text-[10px] text-purple-400 bg-purple-500/10 hover:bg-purple-500/20"
                    >
                      Конвертировать в атом
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {!ctx.isReadOnly && (
        <div className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            onClick={() => {
              ctx.setConvertToAtomItem({
                id: 0,
                order: ctx.getNextOrder(),
                level: 'atom',
                content: '',
                content_en: '',
                content_ru: '',
                atom_ref: '',
                atom_title: '',
              } as any);
              ctx.setShowConvertToAtomModal(true);
            }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white bg-purple-500 hover:bg-purple-600 text-sm"
          >
            <Plus className="w-4 h-4" /> Добавить атом
          </button>
        </div>
      )}
    </div>
  );
}
