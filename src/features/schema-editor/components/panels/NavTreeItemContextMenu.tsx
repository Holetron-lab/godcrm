/**
 * NavTreeItemContextMenu - Context menu dropdown for tree items
 * Handles table, project, and folder actions
 */

import { useRef, useEffect, useState } from 'react';
import {
  PlusCircle,
  Eye,
  Pencil,
  ArrowRightLeft,
  Trash2,
  MoreVertical,
  Crosshair,
  Move,
  ExternalLink,
} from 'lucide-react';
import type { NavTreeNode } from '../../types/schema-editor.types';
import { isTableWidget } from '../widgetIcon';

interface NavTreeItemContextMenuProps {
  node: NavTreeNode;
  primaryTableId: number | undefined;
  t: (key: string) => string;
}

const dispatchTableEvent = (eventName: string, tableId: number) => {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { tableId } }));
};

const dispatchProjectEvent = (eventName: string, projectId: number) => {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { projectId } }));
};

const ITEM_CLASSES = 'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors';

export const NavTreeItemContextMenu = ({ node, primaryTableId, t }: NavTreeItemContextMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen]);

  // A table module gets the table menu of its main table (primaryTableId = mainTableId).
  const tableActions = node.type === 'table' || (node.type === 'widget' && isTableWidget(node.presetName));

  const handleContextAction = (action: string) => {
    setMenuOpen(false);
    if (action === 'editProject') {
      if (node.type === 'project') {
        dispatchProjectEvent('schema-editor:edit-project', node.numericId);
      }
      return;
    }
    if (action === 'openWidget') {
      window.open(`/widgets/${node.numericId}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!primaryTableId) return;
    switch (action) {
      case 'addRow':
        if (tableActions) {
          dispatchTableEvent('schema-editor:add-row', primaryTableId);
        }
        break;
      case 'view':
        if (tableActions) {
          window.open(`/tables/${primaryTableId}`, '_blank');
        }
        break;
      case 'edit':
        if (tableActions) {
          dispatchTableEvent('schema-editor:edit-table', primaryTableId);
        }
        break;
      case 'move':
        if (tableActions) {
          dispatchTableEvent('schema-editor:move-table', primaryTableId);
        }
        break;
      case 'delete':
        if (tableActions) {
          dispatchTableEvent('schema-editor:delete-table', primaryTableId);
        }
        break;
      case 'focus':
        dispatchTableEvent('schema-editor:focus-table', primaryTableId);
        break;
      case 'center':
        if (node.type === 'table') {
          dispatchTableEvent('schema-editor:center-table', primaryTableId);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative flex-shrink-0">
      {/* ⋮ on the right, like the table node header */}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
        aria-label={t('schemaEditor.navMenu.actions')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex h-5 w-4 items-center justify-center rounded text-[var(--text-tertiary)] opacity-60 transition-colors group-hover:opacity-100 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:opacity-100"
      >
        <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl z-[120] overflow-hidden"
        >
          {node.type === 'widget' && (
            <>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('openWidget'); }} className={ITEM_CLASSES}>
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.navMenu.openWidget')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
            </>
          )}
          {tableActions && primaryTableId && (
            <>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('addRow'); }} className={ITEM_CLASSES}>
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.addRow')}</span>
              </button>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('view'); }} className={ITEM_CLASSES}>
                <Eye className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.view')}</span>
              </button>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('edit'); }} className={ITEM_CLASSES}>
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.edit')}</span>
              </button>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('move'); }} className={ITEM_CLASSES}>
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.move')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
              <button
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); handleContextAction('delete'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-500/10 text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.delete')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
            </>
          )}
          {node.type === 'project' && (
            <>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('editProject'); }} className={ITEM_CLASSES}>
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.navMenu.editProject')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
            </>
          )}
          <button
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); handleContextAction('focus'); }}
            className={`${ITEM_CLASSES} disabled:opacity-50 disabled:cursor-not-allowed`}
            disabled={!primaryTableId}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{t('schemaEditor.navMenu.showOnCanvas')}</span>
          </button>
          {node.type === 'table' && (
            <button role="menuitem" onClick={(e) => { e.stopPropagation(); handleContextAction('center'); }} className={ITEM_CLASSES}>
              <Move className="w-3.5 h-3.5" />
              <span>{t('schemaEditor.navMenu.moveToCenter')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
