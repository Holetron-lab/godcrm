/**
 * NavTreeColumnRow - a table column inside the nav tree (last nesting level, no extra indent).
 * Preview is read from the same store rows the node uses; every other action is forwarded to the
 * owning TableNode through `schema-editor:column-action`, so the menu matches the node's row menu.
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Key, Link, MoreVertical } from 'lucide-react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { ColumnData } from '../../types/schema-editor.types';
import { DropdownMenu } from '@/shared/components/ui/DropdownMenu';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { buildColumnMenuItems, dispatchColumnAction, getTypeIcon, hasLinkConfig, type ColumnAction } from '../nodes/TableNodeColumnRow';

interface NavTreeColumnRowProps {
  tableId: number;
  column: ColumnData;
  canMoveUp: boolean;
  canMoveDown: boolean;
  rowsPreview?: Record<string, unknown>[];
  rowsLoading?: boolean;
  paddingLeft: number;
}

export const NavTreeColumnRow = ({ tableId, column, canMoveUp, canMoveDown, rowsPreview, rowsLoading, paddingLeft }: NavTreeColumnRowProps) => {
  const { t } = useLanguage();
  const loadTableRows = useSchemaEditorStore((state) => state.loadTableRows);
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const label = column.displayName || column.name;
  const act = (action: ColumnAction) => () => dispatchColumnAction({ tableId, columnId: column.id, action });
  const reorderable = !column.isPrimaryKey;
  const canDelete = reorderable && !column.isLocked && !column.isFromSource;

  const togglePreview = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    if (next && rowsPreview === undefined && !rowsLoading) loadTableRows(tableId);
  };

  const previewData = rowsPreview || [];
  const value = previewData[previewIndex]?.[column.name];
  const formatted = value === undefined || value === null ? '—' : String(value);

  const menuItems = buildColumnMenuItems(t, column, {
    isExpanded,
    onTogglePreview: togglePreview,
    onOpenSettings: act('settings'),
    onToggleVisibility: reorderable ? act('visibility') : undefined,
    onMoveUp: canMoveUp ? act('moveUp') : undefined,
    onMoveDown: canMoveDown ? act('moveDown') : undefined,
    onAddColumn: reorderable ? (side) => dispatchColumnAction({ tableId, columnId: column.id, action: side === 'above' ? 'addAbove' : 'addBelow' }) : undefined,
    onToggleReadonly: reorderable ? act('readonly') : undefined,
    onDelete: canDelete ? act('delete') : undefined,
  });

  return (
    // Lighter than the tree rows in dark mode, darker in light mode: the column level reads as a sub-list.
    <div className={`bg-black/[0.04] dark:bg-white/[0.05] ${column.isVisible === false ? 'opacity-60' : ''}`}>
      <div
        style={{ paddingLeft }}
        className="group flex items-center gap-1 h-7 pr-2 hover:bg-[var(--bg-secondary)]"
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePreview(); }}
          aria-label={`Preview ${label}`}
          aria-expanded={isExpanded}
          className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] flex-shrink-0"
        >
          {isExpanded
            ? <ChevronDown className="w-3 h-3 text-[var(--text-secondary)]" />
            : <ChevronRight className="w-3 h-3 text-[var(--text-secondary)]" />}
        </button>
        <span className="text-xs flex-shrink-0">{column.icon || getTypeIcon(column.type)}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); act('settings')(); }}
          className="text-sm text-[var(--text-primary)] truncate hover:text-[var(--accent-primary)] transition-colors"
          title={t('schemaEditor.columnMenu.nameHint')}
        >
          {label}
        </button>
        <span className="flex-1 text-[10px] font-mono text-[var(--text-tertiary)] opacity-70 truncate">{column.name}</span>
        {column.isPrimaryKey && <Key className="w-3 h-3 text-amber-500 flex-shrink-0" aria-label="Primary key" />}
        {hasLinkConfig(column) && <Link className="w-3 h-3 text-primary-400 flex-shrink-0" aria-label="Linked column" />}
        <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] flex-shrink-0">{column.type}</span>
        <DropdownMenu
          trigger={
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('columnHeader.actions', { column: label })}
              className="flex h-5 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-60 group-hover:opacity-100 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
          items={menuItems}
        />
      </div>

      {isExpanded && (
        <div style={{ paddingLeft: paddingLeft + 16 }} className="flex items-center gap-1 h-6 pr-2 text-xs">
          {rowsLoading ? (
            <span className="text-[var(--text-tertiary)]">Loading...</span>
          ) : previewData.length === 0 ? (
            <span className="text-[var(--text-tertiary)]">No data</span>
          ) : (
            <>
              <span className="text-[10px] text-[var(--text-tertiary)]">{previewIndex + 1}/{previewData.length}</span>
              <span className="flex-1 truncate font-mono text-[var(--text-primary)]" title={formatted}>
                {formatted.length > 50 ? `${formatted.slice(0, 50)}...` : formatted}
              </span>
            </>
          )}
          {/* Row stepper at the right edge, same as the node: ↓ previous, ↑ next */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => Math.max(0, i - 1)); }}
            disabled={previewIndex === 0}
            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            title="Previous row"
          >
            <ArrowDown className="w-3 h-3 text-[var(--text-secondary)]" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPreviewIndex((i) => Math.min(previewData.length - 1, i + 1)); }}
            disabled={previewIndex >= previewData.length - 1}
            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            title="Next row"
          >
            <ArrowUp className="w-3 h-3 text-[var(--text-secondary)]" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
};
