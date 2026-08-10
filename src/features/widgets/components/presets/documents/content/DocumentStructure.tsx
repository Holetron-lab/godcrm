import { useState, useRef, useEffect } from 'react';
import {
  FileText, Plus, Edit3, Trash2, MoreVertical, Atom, Ticket,
  Copy, ArrowUp, ArrowDown, GripVertical, Eye, EyeOff,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { useSystemVariables } from '@/shared/hooks/useSystemVariables';
import { useDocumentsContext } from '../DocumentsContext';
import { LEVEL_LABELS, LEVEL_ICONS, type DocumentLevel, type DocumentItem, type DocumentRegistryItem } from '../../../../types/documents.types';
import { EditableMarkdownPreview } from './EditableMarkdownPreview';
import { resolveOrderForInsert, type InsertPosition } from '../utils/orderUtils';

/**
 * DocumentStructure - Inline structure editing mode with drag & drop
 * Shows elements as compact items with drag handles for reordering
 */
export interface DocumentStructureProps {
  items: DocumentItem[];
  document: DocumentRegistryItem;
  onSelectItem: (item: DocumentItem) => void;
  onAddItem?: (level: DocumentLevel, afterItemId?: number) => void;
}

export function DocumentStructure({ items, document: docItem, onSelectItem, onAddItem }: DocumentStructureProps) {
  const ctx = useDocumentsContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [addMenuOpenId, setAddMenuOpenId] = useState<number | null>(null);
  const [itemMenuOpenId, setItemMenuOpenId] = useState<number | null>(null); // Item dropdown menu
  const [menuOpenUpward, setMenuOpenUpward] = useState(false); // Open menu upward if near bottom
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set()); // Accordion state
  const [editingItemId, setEditingItemId] = useState<number | null>(null); // Inline editing
  const [editingContent, setEditingContent] = useState<string>('');
  const [structureSubMenuType, setStructureSubMenuType] = useState<'above' | 'below' | null>(null);
  const [levelChangeItemId, setLevelChangeItemId] = useState<number | null>(null); // Level change dropdown

  // Build system variables for MarkdownPreview (includes space variables)
  const variables = useSystemVariables({
    widgetId: ctx.widget?.id,
    projectId: ctx.widget?.dashboard_id,
    spaceId: ctx.spaceId,
    includeSpaceVars: true,
  });

  // Types available for adding (excluding h1 which is doc title)
  const structureLevelTypes: DocumentLevel[] = ['h1', 'h2', 'h3', 'text', 'atom', 'ticket', 'image', 'divider', 'page_break'];

  // Check if menu should open upward
  const checkMenuPosition = (itemId: number) => {
    const button = menuButtonRefs.current.get(itemId);
    if (button) {
      const rect = button.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // Menu is approximately 300px tall, open upward if less than 300px space below
      setMenuOpenUpward(spaceBelow < 300);
    }
  };

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setItemMenuOpenId(null);
      }
    };
    if (itemMenuOpenId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [itemMenuOpenId]);

  // Close level change dropdown on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      setLevelChangeItemId(null);
    };
    if (levelChangeItemId !== null) {
      // Small delay to allow click on menu item
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 10);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [levelChangeItemId]);

  // Toggle expand/collapse
  const toggleExpanded = (itemId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Start inline editing
  const startInlineEdit = (item: DocumentItem) => {
    setEditingItemId(item.id);
    setEditingContent(item.content || '');
  };

  // Save inline edit
  const saveInlineEdit = async () => {
    logger.debug('[DocumentStructure] saveInlineEdit called', { editingItemId, hasContent: !!editingContent });
    if (editingItemId === null) {
      logger.debug('[DocumentStructure] saveInlineEdit: editingItemId is null, returning');
      return;
    }
    if (!ctx.selectedDocument?.content_table_id) {
      logger.debug('[DocumentStructure] saveInlineEdit: no content_table_id, returning');
      return;
    }
    const item = items.find(i => i.id === editingItemId);
    if (item && editingContent !== item.content) {
      // Save to content_XX field based on current language (multilingual tables)
      const contentField = `content_${ctx.currentLanguage}` as const;
      logger.debug('[DocumentStructure] saveInlineEdit: saving', {
        documentId: ctx.selectedDocumentId,
        itemId: editingItemId,
        tableId: ctx.selectedDocument.content_table_id,
        contentField,
        contentLength: editingContent?.length
      });
      await ctx.updateItem({
        documentId: ctx.selectedDocumentId!,
        itemId: editingItemId,
        tableId: ctx.selectedDocument.content_table_id,
        data: { [contentField]: editingContent }
      });
      logger.debug('[DocumentStructure] saveInlineEdit: saved successfully');
    } else {
      logger.debug('[DocumentStructure] saveInlineEdit: no changes to save', {
        itemFound: !!item,
        contentChanged: editingContent !== item?.content
      });
    }
    setEditingItemId(null);
    setEditingContent('');
  };

  // Cancel inline edit
  const cancelInlineEdit = () => {
    setEditingItemId(null);
    setEditingContent('');
  };

  // Calculate page width (same as DocumentPages)
  const [pageWidth, setPageWidth] = useState(595);

  useEffect(() => {
    const updatePageWidth = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const baseWidth = Math.min(595, containerWidth - 80);
        setPageWidth(baseWidth);
      }
    };
    updatePageWidth();
    window.addEventListener('resize', updatePageWidth);
    return () => window.removeEventListener('resize', updatePageWidth);
  }, []);

  // View scale
  const viewScaleFactor = ctx.viewScale / 100;
  const scaledWidth = pageWidth * viewScaleFactor;

  // Get level styling
  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'h1': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-red-500', indent: 0, shortLabel: 'H1', labelBg: 'bg-red-500/20 text-red-400' };
      case 'h2': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-blue-500', indent: 0, shortLabel: 'H2', labelBg: 'bg-blue-500/20 text-blue-400' };
      case 'h3': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-green-500', indent: 16, shortLabel: 'H3', labelBg: 'bg-green-500/20 text-green-400' };
      case 'text': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-gray-400', indent: 32, shortLabel: 'TEXT', labelBg: 'bg-gray-500/20 text-gray-400' };
      case 'image': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-purple-500', indent: 32, shortLabel: 'IMG', labelBg: 'bg-purple-500/20 text-purple-400' };
      case 'divider': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-gray-300', indent: 0, shortLabel: 'DIV', labelBg: 'bg-gray-500/20 text-gray-400' };
      case 'page_break': return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-orange-500', indent: 0, shortLabel: 'PAGE', labelBg: 'bg-orange-500/20 text-orange-400' };
      case 'widget': return { bg: 'bg-cyan-500/5', border: 'border-l-cyan-500', indent: 16, shortLabel: 'WIDGET', labelBg: 'bg-cyan-500/20 text-cyan-400' };
      default: return { bg: 'bg-[var(--bg-tertiary)]', border: 'border-l-gray-400', indent: 0, shortLabel: '?', labelBg: 'bg-gray-500/20 text-gray-400' };
    }
  };

  // Get item display text
  const getItemText = (item: DocumentItem) => {
    if (item.level === 'divider') return '';  // Empty for divider - will show line
    if (item.level === 'page_break') return 'Разрыв страницы';
    if (item.level === 'image') return item.image_url ? item.image_url.substring(0, 40) : 'Без URL';
    if (item.level === 'widget') {
      return item.content?.substring(0, 60) || `Widget #${item.widget_ref ?? item.id}`;
    }
    return item.content?.substring(0, 60) || `Пустой элемент #${item.id}`;
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(itemId));
  };

  const handleDragOver = (e: React.DragEvent, itemId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId !== itemId) {
      setDragOverId(itemId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    setDragOverId(null);

    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const draggedIdx = items.findIndex(i => i.id === draggedId);
    const targetIdx = items.findIndex(i => i.id === targetId);

    if (draggedIdx === -1 || targetIdx === -1 || !ctx.selectedDocument?.content_table_id) {
      setDraggedId(null);
      return;
    }

    const tableId = ctx.selectedDocument.content_table_id;
    const documentId = ctx.selectedDocumentId!;
    const position: InsertPosition =
      draggedIdx < targetIdx
        ? { kind: 'after', afterId: items[targetIdx].id }
        : { kind: 'before', beforeId: items[targetIdx].id };

    // Exclude the dragged row from `items` so we don't anchor the new order
    // against the row's own current value.
    const without = items.filter((i) => i.id !== draggedId);
    const newOrder = await resolveOrderForInsert(without, position, async (id, order) => {
      await ctx.updateItem({ documentId, itemId: id, tableId, data: { order } });
    });

    await ctx.updateItem({
      documentId,
      itemId: draggedId,
      tableId,
      data: { order: newOrder }
    });

    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // Toggle hidden
  const toggleHidden = async (item: DocumentItem) => {
    if (!ctx.selectedDocument?.content_table_id) return;
    await ctx.updateItem({
      documentId: ctx.selectedDocumentId!,
      itemId: item.id,
      tableId: ctx.selectedDocument.content_table_id,
      data: { is_hidden: !item.is_hidden }
    });
  };

  // Delete item
  const handleDelete = async (item: DocumentItem) => {
    if (!ctx.selectedDocument?.content_table_id) return;
    if (!confirm('Удалить этот элемент?')) return;
    await ctx.deleteItem({
      documentId: ctx.selectedDocumentId!,
      itemId: item.id,
      tableId: ctx.selectedDocument.content_table_id,
    });
  };

  // Copy item
  const handleCopy = async (item: DocumentItem) => {
    if (!ctx.selectedDocument?.content_table_id) return;
    const tableId = ctx.selectedDocument.content_table_id;
    const documentId = ctx.selectedDocumentId!;
    const newOrder = await resolveOrderForInsert(
      items,
      { kind: 'after', afterId: item.id },
      async (id, order) => {
        await ctx.updateItem({ documentId, itemId: id, tableId, data: { order } });
      }
    );
    await ctx.addItem({
      documentId,
      tableId,
      data: {
        level: item.level,
        [`content_${ctx.currentLanguage}`]: item.content,
        image_url: item.image_url,
        order: newOrder,
        is_hidden: false,
      }
    });
    setItemMenuOpenId(null);
  };

  // View scale for structure mode
  const structureViewScale = (ctx.viewScale / 100) * 1.4;

  return (
    <div ref={containerRef} className="flex flex-col items-center py-6">
      <div
        className="bg-white dark:bg-gray-900 border border-[var(--border-primary)] rounded-lg shadow-lg"
        style={{ width: scaledWidth, transform: `scale(${structureViewScale})`, transformOrigin: 'top center' }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--color-primary-500)]" />
              <span className="font-medium text-sm">{docItem.name}</span>
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">{items.length} элементов</span>
          </div>
        </div>

        {/* Items list */}
        <div className="divide-y divide-[var(--border-primary)]">
          {items.map((item, index) => {
            const style = getLevelStyle(item.level);
            const isDragging = draggedId === item.id;
            const isDragOver = dragOverId === item.id;
            const isDivider = item.level === 'divider';
            const isExpanded = expandedIds.has(item.id);
            const isEditing = editingItemId === item.id;

            return (
              <div
                key={item.id}
                id={`item-${item.id}`}
                className={cn(
                  "transition-all",
                  isExpanded && "ring-1 ring-blue-500 rounded-lg my-1"
                )}
              >
                <div
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 transition-all border-l-4",
                    !isEditing && "cursor-grab active:cursor-grabbing",
                    style.bg,
                    style.border,
                    isDragging && "opacity-50",
                    isDragOver && "ring-1 ring-[var(--color-primary-500)] ring-inset",
                    isExpanded && "rounded-t-lg",
                    item.is_hidden && "opacity-40"
                  )}
                  style={{ paddingLeft: `${12 + style.indent}px` }}
                >
                  {/* Drag handle */}
                  <GripVertical className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />

                  {/* Content preview or divider line */}
                  {isDivider ? (
                    /* Divider - horizontal line */
                    <div className="flex-1 h-[2px] bg-gray-400 dark:bg-gray-500" />
                  ) : (
                    <span
                      className={cn(
                        "flex-1 truncate cursor-pointer hover:text-[var(--color-primary-500)]",
                        item.level === 'h2' && "text-base font-semibold",
                        item.level === 'h3' && "text-sm font-medium",
                        (item.level === 'text' || item.level === 'image') && "text-sm text-gray-500 dark:text-gray-400",
                        item.level === 'page_break' && "text-xs text-[var(--text-tertiary)]"
                      )}
                      onClick={() => onSelectItem(item)}
                    >
                      {getItemText(item)}
                    </span>
                  )}

                  {/* Right side: Expand + Atom icon + Level badge + Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Expand/collapse for text/image */}
                    {(item.level === 'text' || item.level === 'image') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
                        className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)]"
                        title={expandedIds.has(item.id) ? "Свернуть" : "Развернуть"}
                      >
                        <ChevronDown className={cn(
                          "w-3.5 h-3.5 transition-transform",
                          expandedIds.has(item.id) && "rotate-180"
                        )} />
                      </button>
                    )}

                    {/* Atom icon - purple if has atom, gray otherwise - only for text/image elements */}
                    {(item.level === 'text' || item.level === 'image') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectItem(item); }}
                        className={cn(
                          "p-1 rounded",
                          item.atom_ref
                            ? "text-purple-500 hover:bg-purple-500/20"
                            : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"
                        )}
                        title={item.atom_ref ? "Атом привязан" : "Привязать атом"}
                      >
                        <Atom className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Level badge - clickable to change level */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLevelChangeItemId(levelChangeItemId === item.id ? null : item.id);
                        }}
                        className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 hover:opacity-80 cursor-pointer", style.labelBg)}
                        title="Изменить тип элемента"
                      >
                        {style.shortLabel}
                      </button>

                      {levelChangeItemId === item.id && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[120px]">
                          {structureLevelTypes.map(lvl => {
                            const lvlStyle = getLevelStyle(lvl);
                            return (
                              <button
                                key={lvl}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (lvl !== item.level) {
                                    ctx.updateItem({
                                      documentId: docItem.id,
                                      tableId: docItem.content_table_id,
                                      itemId: item.id,
                                      updates: { level: lvl }
                                    });
                                  }
                                  setLevelChangeItemId(null);
                                }}
                                className={cn(
                                  "w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]",
                                  lvl === item.level && "bg-[var(--bg-secondary)]"
                                )}
                              >
                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", lvlStyle.labelBg)}>
                                  {lvlStyle.shortLabel}
                                </span>
                                <span className="text-[var(--text-primary)]">{lvlStyle.shortLabel}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Hidden indicator */}
                    {item.is_hidden && (
                      <EyeOff className="w-3.5 h-3.5 text-yellow-500" />
                    )}

                    {/* Item menu - three dots */}
                    <div className="relative" ref={itemMenuOpenId === item.id ? menuRef : undefined}>
                      <button
                        ref={(el) => { if (el) menuButtonRefs.current.set(item.id, el); }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (itemMenuOpenId === item.id) {
                            setItemMenuOpenId(null);
                          } else {
                            checkMenuPosition(item.id);
                            setItemMenuOpenId(item.id);
                          }
                        }}
                        className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)]"
                        title="Меню"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {itemMenuOpenId === item.id && (
                        <div className={cn(
                          "absolute right-0 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[180px]",
                          menuOpenUpward ? "bottom-full mb-1" : "top-full mt-1"
                        )}>
                          {/* Edit raw */}
                          {(item.level === 'text' || item.level === 'image') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setItemMenuOpenId(null);
                                // Expand accordion
                                setExpandedIds(prev => new Set(prev).add(item.id));
                                // Open right panel
                                ctx.setSelectedItemId(item.id);
                                ctx.setRightPanelMode('settings');
                                ctx.setRightPanelOpen(true);
                                // Start inline editing
                                startInlineEdit(item);
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Редактировать
                            </button>
                          )}

                          {/* Copy */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(item); }}
                            className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Копировать
                          </button>

                          {/* Hide/Show */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setItemMenuOpenId(null); toggleHidden(item); }}
                            className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]"
                          >
                            {item.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            {item.is_hidden ? 'Показать' : 'Скрыть'}
                          </button>

                          <div className="border-t border-[var(--border-primary)] my-1" />

                          {/* Add element above - with submenu */}
                          <div
                            className="relative"
                            onMouseEnter={() => setStructureSubMenuType('above')}
                            onMouseLeave={() => setStructureSubMenuType(null)}
                          >
                            <button
                              className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)] justify-between"
                            >
                              <span className="flex items-center gap-2">
                                <ArrowUp className="w-3.5 h-3.5" />
                                Добавить выше
                              </span>
                              <ChevronDown className="w-3 h-3 -rotate-90" />
                            </button>
                            {structureSubMenuType === 'above' && (
                              <div className="absolute left-full -ml-1 top-0 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px] z-50">
                                {structureLevelTypes.map(level => (
                                  <button
                                    key={level}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setItemMenuOpenId(null);
                                      const idx = items.findIndex(i => i.id === item.id);
                                      const prevItem = idx > 0 ? items[idx - 1] : null;
                                      onAddItem?.(level, prevItem?.id);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]"
                                  >
                                    <span>{LEVEL_ICONS[level]}</span>
                                    {LEVEL_LABELS[level]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Add element below - with submenu */}
                          <div
                            className="relative"
                            onMouseEnter={() => setStructureSubMenuType('below')}
                            onMouseLeave={() => setStructureSubMenuType(null)}
                          >
                            <button
                              className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)] justify-between"
                            >
                              <span className="flex items-center gap-2">
                                <ArrowDown className="w-3.5 h-3.5" />
                                Добавить ниже
                              </span>
                              <ChevronDown className="w-3 h-3 -rotate-90" />
                            </button>
                            {structureSubMenuType === 'below' && (
                              <div className="absolute left-full -ml-1 top-0 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px] z-50">
                                {structureLevelTypes.map(level => (
                                  <button
                                    key={level}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setItemMenuOpenId(null);
                                      onAddItem?.(level, item.id);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-secondary)]"
                                  >
                                    <span>{LEVEL_ICONS[level]}</span>
                                    {LEVEL_LABELS[level]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="border-t border-[var(--border-primary)] my-1" />

                          {/* Delete */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setItemMenuOpenId(null); handleDelete(item); }}
                            className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded content for text/image with inline editing */}
                {(item.level === 'text' || item.level === 'image') && isExpanded && (
                  <div
                    className="p-3 bg-gray-100 dark:bg-gray-800/50 rounded-b-lg"
                    style={{ marginLeft: `${style.indent}px` }}
                  >
                    {item.level === 'text' ? (
                      isEditing ? (
                        /* Inline editing textarea */
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-3 focus:border-blue-500 outline-none resize-none font-mono leading-relaxed"
                          rows={Math.max(5, (editingContent?.split('\n').length || 1) + 2)}
                          autoFocus
                          onBlur={saveInlineEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelInlineEdit();
                            if (e.key === 'Enter' && e.ctrlKey) saveInlineEdit();
                          }}
                        />
                      ) : (
                        /* Interactive preview - tables with editable cells */
                        <EditableMarkdownPreview
                          content={item.content || ''}
                          onContentChange={async (newContent) => {
                            if (!ctx.selectedDocument?.content_table_id) return;
                            // Save to content_XX field based on current language
                            const contentField = `content_${ctx.currentLanguage}` as const;
                            await ctx.updateItem({
                              documentId: ctx.selectedDocumentId!,
                              itemId: item.id,
                              tableId: ctx.selectedDocument.content_table_id,
                              data: { [contentField]: newContent }
                            });
                          }}
                          onEditRaw={() => startInlineEdit(item)}
                          variables={variables}
                        />
                      )
                    ) : (
                      /* Image preview */
                      <div className="text-sm" onClick={() => onSelectItem(item)}>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt="Preview"
                            className="rounded object-contain cursor-pointer hover:opacity-80"
                          />
                        ) : (
                          <span className="text-[var(--text-tertiary)] cursor-pointer">Нажмите чтобы добавить изображение...</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Add button between items */}
                <div
                  className="relative group"
                  onMouseEnter={() => setAddMenuOpenId(item.id)}
                  onMouseLeave={() => setAddMenuOpenId(null)}
                >
                  <div className="h-0 group-hover:h-8 transition-all overflow-hidden flex items-center justify-center">
                    <button
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-secondary)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)]"
                    >
                      <Plus className="w-3 h-3" /> Добавить
                    </button>
                  </div>

                  {/* Add menu */}
                  {addMenuOpenId === item.id && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-0 pt-8 z-50">
                      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]">
                        {(['h2', 'h3', 'text', 'image', 'divider', 'page_break'] as DocumentLevel[]).map(level => (
                          <button
                            key={level}
                            onClick={() => { onAddItem?.(level, item.id); setAddMenuOpenId(null); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-secondary)]"
                          >
                            <span>{LEVEL_ICONS[level]}</span>
                            <span>{LEVEL_LABELS[level]}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick add buttons at end */}
        <div className="px-4 py-3 bg-[var(--bg-secondary)] flex items-center justify-center gap-2 flex-wrap">
          {(['h2', 'h3', 'text', 'image', 'divider', 'page_break'] as DocumentLevel[]).map(level => {
            const shortLabels: Record<string, string> = { h2: '+H2', h3: '+H3', text: '+Текст', image: '+Изобр.', divider: '+Разд.', page_break: '+Разрыв' };
            return (
              <button
                key={level}
                onClick={() => onAddItem?.(level)}
                className="px-2 py-1 rounded text-xs border border-dashed border-[var(--border-secondary)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)] transition-colors"
              >
                {shortLabels[level]}
              </button>
            );
          })}
          <button
            onClick={() => {
              ctx.setConvertToTicketItem({
                id: 0,
                order: ctx.getNextOrder(),
                level: 'text',
                content: '',
              } as DocumentItem);
              ctx.setShowConvertToTicketModal(true);
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
            title="Создать тикет"
          >
            <Ticket className="w-3.5 h-3.5" />
            Тикет
          </button>
        </div>

        {/* Empty state */}
        {items.length === 0 && (
          <div className="p-8 text-center text-[var(--text-tertiary)]">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Документ пуст</p>
            <p className="text-xs mt-2">Нажмите "Добавить элемент" чтобы начать</p>
          </div>
        )}
      </div>
    </div>
  );
}
