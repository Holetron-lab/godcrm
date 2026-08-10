/**
 * Structure Editor Modal Component with Drag & Drop
 */

import { useState } from 'react';
import {
  X,
  Save,
  Layers,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { useDocumentsContext } from '../DocumentsContext';
import type { DocumentItem } from '../../../../types/documents.types';

export function StructureEditorModal() {
  const ctx = useDocumentsContext();
  const [localItems, setLocalItems] = useState<DocumentItem[]>(() =>
    [...ctx.items].sort((a, b) => a.order - b.order)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Get level badge styling
  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'h2': return { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'H2' };
      case 'h3': return { bg: 'bg-green-500/20', text: 'text-green-400', label: 'H3' };
      case 'text': return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'TEXT' };
      case 'divider': return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'DIV' };
      default: return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: level.toUpperCase() };
    }
  };

  // Get item display text
  const getItemText = (item: DocumentItem) => {
    if (item.level === 'divider') return '— — — разделитель — — —';
    return item.content?.substring(0, 40) || `Элемент #${item.id}`;
  };

  // Get indent level
  const getIndent = (level: string) => {
    switch (level) {
      case 'h2': return 0;
      case 'h3': return 20;
      case 'text': return 40;
      case 'divider': return 20;
      default: return 0;
    }
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

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    setDragOverId(null);

    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const draggedIdx = localItems.findIndex(i => i.id === draggedId);
    const targetIdx = localItems.findIndex(i => i.id === targetId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedId(null);
      return;
    }

    // Reorder items
    const newItems = [...localItems];
    const [draggedItem] = newItems.splice(draggedIdx, 1);
    newItems.splice(targetIdx, 0, draggedItem);

    // Reassign orders
    newItems.forEach((item, idx) => {
      item.order = idx + 1;
    });

    setLocalItems(newItems);
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // Move item up/down
  const moveItem = (itemId: number, direction: 'up' | 'down') => {
    const idx = localItems.findIndex(i => i.id === itemId);
    if (idx === -1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= localItems.length) return;

    const newItems = [...localItems];
    [newItems[idx], newItems[newIdx]] = [newItems[newIdx], newItems[idx]];

    // Reassign orders
    newItems.forEach((item, i) => {
      item.order = i + 1;
    });

    setLocalItems(newItems);
  };

  const toggleHidden = (id: number) => {
    setLocalItems(prev => prev.map(item =>
      item.id === id ? { ...item, is_hidden: !item.is_hidden } : item
    ));
  };

  const deleteLocalItem = (id: number) => {
    setLocalItems(prev => {
      const filtered = prev.filter(item => item.id !== id);
      // Reassign orders
      return filtered.map((item, idx) => ({ ...item, order: idx + 1 }));
    });
  };

  const handleSave = async () => {
    if (!ctx.selectedDocument?.content_table_id || !ctx.selectedDocumentId) return;

    setIsSaving(true);
    try {
      // Find deleted items
      const currentIds = new Set(localItems.map(i => i.id));
      const deletedItems = ctx.items.filter(i => !currentIds.has(i.id));

      // Delete removed items
      for (const item of deletedItems) {
        await ctx.deleteItem({
          documentId: ctx.selectedDocumentId,
          itemId: item.id,
          tableId: ctx.selectedDocument.content_table_id
        });
      }

      // Update all items with new order and is_hidden
      for (const item of localItems) {
        const originalItem = ctx.items.find(i => i.id === item.id);
        if (originalItem && (originalItem.order !== item.order || originalItem.is_hidden !== item.is_hidden)) {
          await ctx.updateItem({
            documentId: ctx.selectedDocumentId,
            itemId: item.id,
            tableId: ctx.selectedDocument.content_table_id,
            data: { order: item.order, is_hidden: item.is_hidden }
          });
        }
      }
      ctx.refresh();
      ctx.setShowStructureModal(false);
    } catch (err) {
      logger.error('Failed to save structure:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRebuild = () => {
    // Rebuild order from scratch
    const newItems = localItems.map((item, idx) => ({
      ...item,
      order: idx + 1
    }));
    setLocalItems(newItems);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-blue-500" />
            <span className="font-medium">Редактор структуры</span>
          </div>
          <button
            onClick={() => ctx.setShowStructureModal(false)}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs text-[var(--text-tertiary)] mb-4 flex items-center justify-between">
            <span>Все элементы документа</span>
            <span>{localItems.length} элементов</span>
          </div>

          <div className="space-y-1">
            {localItems.map((item, index) => {
              const badge = getLevelBadge(item.level);
              const isDragging = draggedId === item.id;
              const isDragOver = dragOverId === item.id;
              const isHidden = item.is_hidden;

              // Special rendering for dividers
              if (item.level === 'divider') {
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, item.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex items-center gap-2 py-2 cursor-grab active:cursor-grabbing transition-all",
                      isDragging && "opacity-50",
                      isDragOver && "bg-[var(--color-primary-500)]/10",
                      isHidden && "opacity-40"
                    )}
                    style={{ marginLeft: 20, marginRight: 20 }}
                  >
                    <GripVertical className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />
                    <div className="flex-1 h-px bg-[var(--border-secondary)]" />

                    {/* Action buttons */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleHidden(item.id); }}
                      className={cn("p-1 rounded", isHidden ? "text-yellow-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
                      title={isHidden ? "Показать" : "Скрыть"}
                    >
                      {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteLocalItem(item.id); }}
                      className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500"
                      title="Удалить"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing",
                    isDragging && "opacity-50 border-dashed",
                    isDragOver && "border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10",
                    isHidden && "opacity-40",
                    !isDragging && !isDragOver && "border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]"
                  )}
                  style={{ marginLeft: getIndent(item.level) }}
                >
                  <GripVertical className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />

                  <span className={cn("flex-1 truncate text-sm", isHidden && "line-through")}>
                    {getItemText(item)}
                  </span>

                  {/* Atom indicator */}
                  {item.atom_ref && (
                    <span className="px-1 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-400">
                      ⚛
                    </span>
                  )}

                  {/* Level badge */}
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0",
                    badge.bg, badge.text
                  )}>
                    {badge.label}
                  </span>

                  {/* Hide/Show button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleHidden(item.id); }}
                    className={cn("p-1 rounded", isHidden ? "text-yellow-500" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}
                    title={isHidden ? "Показать" : "Скрыть"}
                  >
                    {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>

                  {/* Move buttons */}
                  <button
                    onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'up'); }}
                    disabled={index === 0}
                    className="p-1 rounded hover:bg-[var(--bg-primary)] disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'down'); }}
                    disabled={index === localItems.length - 1}
                    className="p-1 rounded hover:bg-[var(--bg-primary)] disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLocalItem(item.id); }}
                    className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {localItems.length === 0 && (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Нет элементов для редактирования</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            onClick={handleRebuild}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--bg-tertiary)]"
          >
            <RefreshCw className="w-4 h-4" />
            Перенумеровать
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => ctx.setShowStructureModal(false)}
              className="px-4 py-2 rounded-lg text-sm hover:bg-[var(--bg-tertiary)]"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
