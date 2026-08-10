import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, Trash2, Copy, ArrowUp, ArrowDown, ChevronDown, MoveUp, MoveDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { LEVEL_LABELS, LEVEL_ICONS, type DocumentLevel, type DocumentItem } from '../../../../types/documents.types';
import { getLevelBadgeClass, addLevelTypes } from './utils';

/**
 * ItemMenu - Dropdown menu with Portal for element actions
 * Renders outside overflow container to avoid clipping
 */
export interface ItemMenuProps {
  item: DocumentItem;
  position: { top: number; left: number };
  isOpen: boolean;
  onClose: () => void;
  onAddBefore: (item: DocumentItem, level: DocumentLevel) => void;
  onAddAfter: (item: DocumentItem, level: DocumentLevel) => void;
  onDelete: (itemId: number) => void;
  onMoveUp: (item: DocumentItem) => void;
  onMoveDown: (item: DocumentItem) => void;
  onEdit?: (item: DocumentItem) => void;
  onCopy?: (item: DocumentItem) => void;
  isFirst: boolean;
  isLast: boolean;
  showEditCopy?: boolean;
}

export function ItemMenu({
  item,
  position,
  isOpen,
  onClose,
  onAddBefore,
  onAddAfter,
  onDelete,
  onMoveUp,
  onMoveDown,
  onEdit,
  onCopy,
  isFirst,
  isLast,
  showEditCopy = false
}: ItemMenuProps) {
  const [addSubMenuType, setAddSubMenuType] = useState<'above' | 'below' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Small delay to avoid immediate close on open click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuContent = (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Edit & Copy - only for text elements */}
      {showEditCopy && onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(item); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)]"
        >
          <Edit3 className="w-3 h-3" />
          Редактировать
        </button>
      )}
      {showEditCopy && onCopy && (
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(item); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)]"
        >
          <Copy className="w-3 h-3" />
          Копировать
        </button>
      )}
      {showEditCopy && <div className="border-t border-[var(--border-secondary)] my-1" />}

      {/* Move Up/Down */}
      {!isFirst && (
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp(item); }}
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)]"
        >
          <MoveUp className="w-3 h-3" />
          Переместить выше
        </button>
      )}
      {!isLast && (
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown(item); }}
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)]"
        >
          <MoveDown className="w-3 h-3" />
          Переместить ниже
        </button>
      )}
      {(!isFirst || !isLast) && <div className="border-t border-[var(--border-secondary)] my-1" />}

      {/* Add above - with submenu */}
      <div
        className="relative"
        onMouseEnter={() => setAddSubMenuType('above')}
        onMouseLeave={() => setAddSubMenuType(null)}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)] justify-between"
        >
          <span className="flex items-center gap-2">
            <ArrowUp className="w-3 h-3" />
            Добавить выше
          </span>
          <ChevronDown className="w-3 h-3 -rotate-90" />
        </button>
        {addSubMenuType === 'above' && (
          <div className="absolute right-full top-0 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]">
            {addLevelTypes.map(level => (
              <button
                key={level}
                onClick={(e) => { e.stopPropagation(); onAddBefore(item, level); onClose(); }}
                className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-[var(--bg-tertiary)]"
              >
                <span>{LEVEL_LABELS[level]}</span>
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono uppercase", getLevelBadgeClass(level))}>
                  {LEVEL_ICONS[level]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add below - with submenu */}
      <div
        className="relative"
        onMouseEnter={() => setAddSubMenuType('below')}
        onMouseLeave={() => setAddSubMenuType(null)}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)] justify-between"
        >
          <span className="flex items-center gap-2">
            <ArrowDown className="w-3 h-3" />
            Добавить ниже
          </span>
          <ChevronDown className="w-3 h-3 -rotate-90" />
        </button>
        {addSubMenuType === 'below' && (
          <div className="absolute right-full top-0 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]">
            {addLevelTypes.map(level => (
              <button
                key={level}
                onClick={(e) => { e.stopPropagation(); onAddAfter(item, level); onClose(); }}
                className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-[var(--bg-tertiary)]"
              >
                <span>{LEVEL_LABELS[level]}</span>
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono uppercase", getLevelBadgeClass(level))}>
                  {LEVEL_ICONS[level]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-secondary)] my-1" />
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); onDelete(item.id); }}
        className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 text-red-500"
      >
        <Trash2 className="w-3 h-3" />
        Удалить
      </button>
    </div>
  );

  return createPortal(menuContent, document.body);
}
