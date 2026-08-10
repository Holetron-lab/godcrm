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
  LayoutGrid,
  Table2,
  FolderOpen,
} from 'lucide-react';
import type { NavTreeNode } from '../../types/schema-editor.types';

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

  const handleContextAction = (action: string) => {
    setMenuOpen(false);
    if (action === 'editProject') {
      if (node.type === 'project') {
        dispatchProjectEvent('schema-editor:edit-project', node.numericId);
      }
      return;
    }
    if (!primaryTableId) return;
    switch (action) {
      case 'addRow':
        if (node.type === 'table') {
          dispatchTableEvent('schema-editor:add-row', primaryTableId);
        }
        break;
      case 'view':
        if (node.type === 'table') {
          window.open(`/tables/${primaryTableId}`, '_blank');
        }
        break;
      case 'edit':
        if (node.type === 'table') {
          dispatchTableEvent('schema-editor:edit-table', primaryTableId);
        }
        break;
      case 'move':
        if (node.type === 'table') {
          dispatchTableEvent('schema-editor:move-table', primaryTableId);
        }
        break;
      case 'delete':
        if (node.type === 'table') {
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
      <button
        ref={menuButtonRef}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
        className={`rounded p-0.5 transition-colors hover:bg-[var(--bg-tertiary)] ${
          node.type === 'project'
            ? 'text-[var(--accent-primary)]'
            : node.type === 'folder'
            ? 'text-amber-500'
            : 'text-green-500'
        }`}
        title={node.type.toUpperCase()}
      >
        {node.type === 'project' ? (
          <LayoutGrid className="w-3.5 h-3.5" />
        ) : node.type === 'folder' ? (
          <FolderOpen className="w-3.5 h-3.5" />
        ) : (
          <Table2 className="w-3.5 h-3.5" />
        )}
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl z-[120] overflow-hidden"
        >
          {node.type === 'table' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleContextAction('addRow'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.addRow')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleContextAction('view'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.view')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleContextAction('edit'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.edit')}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleContextAction('move'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>{t('schemaEditor.tableMenu.move')}</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
              <button
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
              <button
                onClick={(e) => { e.stopPropagation(); handleContextAction('editProject'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Редактировать проект</span>
              </button>
              <div className="border-t border-[var(--border-primary)]" />
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleContextAction('focus'); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!primaryTableId}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Показать на воркфлоу</span>
          </button>
          {node.type === 'table' && (
            <button
              onClick={(e) => { e.stopPropagation(); handleContextAction('center'); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Перенести в центр</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
