import { memo, useId, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Key, Link, ChevronUp, ChevronDown, ArrowDown, ArrowUp, Check, MoreVertical, Eye, EyeOff, Settings2, ArrowUpDown, Plus, Lock, Unlock, Trash2 } from 'lucide-react';
import type { ColumnData } from '../../types/schema-editor.types';
import { COLUMN_TYPE_METADATA, type ColumnType } from '@/shared/types';
import { DropdownMenu, type DropdownMenuItem } from '@/shared/components/ui/DropdownMenu';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Column emoji fallback by type (source of truth: COLUMN_TYPE_METADATA); shared with the nav tree row.
export const getTypeIcon = (type: string): string => {
  const meta = COLUMN_TYPE_METADATA[type as ColumnType];
  return meta?.emoji || '📌';
};

// Check if column has relation (source - links TO another table)
export const hasRelationConfig = (column: ColumnData): boolean => {
  if (!column.config) return false;
  const config = column.config as any;
  // Check for relation config (source side)
  if (config.relation?.tableId || config.relatedTableId) return true;
  if (config.linkedTableId) return true;
  return false;
};

// Check if column has inverse relation (target - receives links FROM another table)
export const hasInverseRelationConfig = (column: ColumnData): boolean => {
  if (!column.config) return false;
  const config = column.config as any;
  // Check for inverse relation config (target side)
  if (config.inverseRelation?.enabled || config.inverseRelation?.tableId) return true;
  return false;
};

// Check if column has any link (relation or inverse)
export const hasLinkConfig = (column: ColumnData): boolean => {
  return hasRelationConfig(column) || hasInverseRelationConfig(column);
};

// Invisible edge anchors; xyflow measures their DOM position, so edges follow the real row.
const HANDLE_CLASSES = '!w-0 !h-0 !bg-transparent !border-0 !min-w-0 !min-h-0';

type Translate = ReturnType<typeof useLanguage>['t'];

// Column actions another surface (the nav tree) asks the owning TableNode to perform.
export type ColumnAction = 'settings' | 'visibility' | 'readonly' | 'moveUp' | 'moveDown' | 'addAbove' | 'addBelow' | 'delete';
export interface ColumnActionDetail { tableId: number; columnId: string; action: ColumnAction }
export const COLUMN_ACTION_EVENT = 'schema-editor:column-action';
export const dispatchColumnAction = (detail: ColumnActionDetail) =>
  window.dispatchEvent(new CustomEvent<ColumnActionDetail>(COLUMN_ACTION_EVENT, { detail }));

export interface ColumnMenuHandlers {
  isExpanded: boolean;
  onTogglePreview: () => void;
  onOpenSettings?: () => void;
  onToggleVisibility?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddColumn?: (side: 'above' | 'below') => void;
  onToggleReadonly?: () => void;
  onDelete?: () => void;
}

// One menu definition for the node row and the nav tree row; an item is hidden when its handler is absent.
export const buildColumnMenuItems = (t: Translate, column: ColumnData, h: ColumnMenuHandlers): DropdownMenuItem[] => {
  const isHidden = column.isVisible === false;
  return [
    { label: t(h.isExpanded ? 'schemaEditor.columnMenu.previewOff' : 'schemaEditor.columnMenu.preview'), value: 'preview', icon: <Eye className="h-4 w-4" />, active: h.isExpanded, onSelect: h.onTogglePreview },
    ...(h.onOpenSettings ? [{ label: t('columnHeader.settings'), value: 'settings', icon: <Settings2 className="h-4 w-4" />, onSelect: h.onOpenSettings }] : []),
    ...(h.onToggleVisibility ? [{ label: t(isHidden ? 'schemaEditor.columnMenu.show' : 'columnHeader.hide'), value: 'visibility', icon: isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />, onSelect: h.onToggleVisibility }] : []),
    ...((h.onMoveUp || h.onMoveDown) ? [{ label: t('columnHeader.move'), value: 'move', icon: <ArrowUpDown className="h-4 w-4" />, submenu: [
      ...(h.onMoveUp ? [{ label: t('schemaEditor.columnMenu.moveUp'), value: 'up', onSelect: h.onMoveUp }] : []),
      ...(h.onMoveDown ? [{ label: t('schemaEditor.columnMenu.moveDown'), value: 'down', onSelect: h.onMoveDown }] : []),
    ] }] : []),
    ...(h.onAddColumn ? [
      { label: t('schemaEditor.columnMenu.addAbove'), value: 'add-above', icon: <Plus className="h-4 w-4" />, onSelect: () => h.onAddColumn?.('above') },
      { label: t('schemaEditor.columnMenu.addBelow'), value: 'add-below', icon: <Plus className="h-4 w-4" />, onSelect: () => h.onAddColumn?.('below') },
    ] : []),
    ...(h.onToggleReadonly ? [{ label: t(column.isReadonly ? 'columnHeader.readOnlyOff' : 'columnHeader.readOnly'), value: 'readonly', icon: column.isReadonly ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />, active: column.isReadonly, onSelect: h.onToggleReadonly }] : []),
    ...(h.onDelete ? [{ label: t('columnHeader.delete'), value: 'delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: h.onDelete }] : []),
  ];
};

// Column Row Sub-component; owns the source/target handles for its column
export interface ColumnRowProps {
  column: ColumnData;
  tableId: number;
  isSelected: boolean;
  linkType: 'none' | 'relation' | 'inverse'; // Type of link for coloring
  isPendingConnected: boolean; // Is this column part of a pending connection
  rowsPreview?: Record<string, any>[];  // Pre-loaded rows from parent
  rowsLoading?: boolean;  // Loading state from parent
  canReorder?: boolean;   // Emoji becomes a sortable drag handle (parent owns the DndContext)
  onSelect: () => void;
  onOpenSettings?: (column: ColumnData) => void;
  onChangeType?: (column: ColumnData, newType: string) => void;
  onLoadRows?: () => void;  // Trigger loading rows if not yet loaded
  // Column menu (mirrors the universal table header menu); each item is hidden when its handler is absent
  onToggleVisibility?: (column: ColumnData) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddColumn?: (side: 'above' | 'below') => void; // insert relative to this column
  onToggleReadonly?: (column: ColumnData) => void;
  onDelete?: (column: ColumnData) => void; // caller owns the confirmation
}

export const ColumnRow = memo(
  ({ column, tableId, isSelected, linkType, isPendingConnected, rowsPreview, rowsLoading, canReorder, onSelect, onOpenSettings, onChangeType, onLoadRows, onToggleVisibility, onMoveUp, onMoveDown, onAddColumn, onToggleReadonly, onDelete }: ColumnRowProps) => {
    const { t } = useLanguage();
    const previewId = useId();
    const [isExpanded, setIsExpanded] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [copied, setCopied] = useState(false);
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: column.id, disabled: !canReorder });

    // Trigger loading rows when first expanded if not yet loaded
    useEffect(() => {
      if (isExpanded && rowsPreview === undefined && !rowsLoading && onLoadRows) {
        onLoadRows();
      }
    }, [isExpanded, rowsPreview, rowsLoading, onLoadRows, tableId]);

    const handleRowClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      // Toggle accordion
      setIsExpanded(!isExpanded);
    };

    const handleIconClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onOpenSettings) {
        onOpenSettings(column);
      }
    };

    // Click (or Enter) on the name opens the column settings; Ctrl/Cmd+click (or Ctrl+Enter) copies the key.
    const handleNameClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        navigator.clipboard.writeText(column.name).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
        return;
      }
      onOpenSettings?.(column);
    };

    const handlePrevRow = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (previewIndex > 0) {
        setPreviewIndex(previewIndex - 1);
      }
    };

    const handleNextRow = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (previewIndex < previewData.length - 1) {
        setPreviewIndex(previewIndex + 1);
      }
    };

    const { name, displayName, type, icon, isPrimaryKey } = column;
    const label = displayName || name;
    const displayIcon = icon || getTypeIcon(type);
    const isLinked = hasLinkConfig(column);
    const isHidden = column.isVisible === false;

    const baseClasses = "relative flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all duration-150";

    // Highlight based on link type:
    // - Green for any relation (source or inverse)
    // - Blue for pending connected columns
    const linkedHighlightClasses = isPendingConnected
      ? "bg-primary-500/15 border-l-2 border-l-primary-400"
      : (linkType === 'relation' || linkType === 'inverse')
      ? "bg-emerald-500/10 border-l-2 border-l-emerald-400"
      : "";

    const selectedClasses = isSelected
      ? "bg-[var(--accent-primary)]/20 ring-1 ring-[var(--accent-primary)] ring-inset"
      : "";

    const hoverClasses = !isSelected ? "hover:bg-[var(--bg-secondary)]" : "";

    // Get current preview value from rowsPreview
    const previewData = rowsPreview || [];
    const currentPreviewValue = previewData[previewIndex]?.[column.name];
    const formattedPreviewValue = currentPreviewValue !== undefined && currentPreviewValue !== null
      ? String(currentPreviewValue)
      : '—';

    const menuItems = buildColumnMenuItems(t, column, {
      isExpanded,
      onTogglePreview: () => setIsExpanded(!isExpanded),
      onOpenSettings: onOpenSettings && (() => onOpenSettings(column)),
      onToggleVisibility: onToggleVisibility && (() => onToggleVisibility(column)),
      onMoveUp,
      onMoveDown,
      onAddColumn,
      onToggleReadonly: onToggleReadonly && (() => onToggleReadonly(column)),
      onDelete: onDelete && (() => onDelete(column)),
    });

    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`border-b border-[var(--border-primary)] last:border-b-0 ${isHidden ? 'opacity-60' : ''} ${isDragging ? 'relative z-10 shadow-lg bg-[var(--bg-primary)]' : ''}`}
      >
        <div
          className={`${baseClasses} ${linkedHighlightClasses} ${selectedClasses} ${hoverClasses}`}
        >
          <Handle type="target" position={Position.Left} id={`target-col-${name}`} className={HANDLE_CLASSES} />
          <Handle type="source" position={Position.Right} id={`source-col-${name}`} className={HANDLE_CLASSES} />
          <button
            type="button"
            onClick={handleRowClick}
            aria-label={`Preview ${label}`}
            aria-expanded={isExpanded}
            aria-controls={previewId}
            className="absolute inset-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
          />
          {/* Only the checkbox toggles column selection. */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onSelect}
            aria-label={`Select ${label}`}
            className="relative w-4 h-4 rounded flex-shrink-0 cursor-pointer accent-[var(--accent-primary)]"
          />

          {/* Icon - drag handle for reordering (nodrag keeps xyflow from moving the node); click opens settings */}
          <button
            type="button"
            ref={canReorder ? setActivatorNodeRef : undefined}
            {...(canReorder ? { ...attributes, ...listeners } : {})}
            onClick={handleIconClick}
            disabled={!onOpenSettings && !canReorder}
            aria-label={`Open column settings: ${label}`}
            className={`nodrag relative text-sm flex-shrink-0 touch-none select-none transition-transform hover:scale-110 ${canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
            title={canReorder ? t('schemaEditor.columnMenu.drag', { column: label }) : 'Open column settings'}
          >
            {displayIcon}
          </button>

          {/* Display name - click opens settings, Ctrl+click copies key */}
          <button
            type="button"
            onClick={handleNameClick}
            className="relative text-sm text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
            title={t('schemaEditor.columnMenu.nameHint')}
          >
            {label}
            {copied && <Check className="w-3 h-3 inline ml-1 text-green-500" />}
          </button>

          {/* Key (column name) */}
          <span className="pointer-events-none text-xs font-mono text-[var(--text-tertiary)] truncate">
            {name}
          </span>

          {/* Preview toggle (the full-row button above is the keyboard/a11y control for the same action) */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={handleRowClick}
            className="nodrag relative ml-auto flex h-5 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <select
            value={type}
            onChange={(event) => onChangeType?.(column, event.target.value)}
            disabled={!onChangeType}
            aria-label={`Column type: ${label}`}
            // Plain text, no native arrow: a click on the type still opens the picker.
            className="nodrag relative max-w-24 appearance-none text-[10px] font-mono text-[var(--text-tertiary)] bg-transparent uppercase cursor-pointer hover:text-[var(--accent-primary)] px-1 py-0.5 rounded"
          >
            {!Object.keys(COLUMN_TYPE_METADATA).includes(type) && <option value={type}>{type}</option>}
            {Object.entries(COLUMN_TYPE_METADATA).map(([typeKey, meta]) => (
              <option key={typeKey} value={typeKey}>{meta.labelEn}</option>
            ))}
          </select>

          {/* PK indicator */}
          {isPrimaryKey && (
            <span className="pointer-events-none flex-shrink-0" title="Primary Key">
              <Key className="w-3 h-3 text-amber-500" />
            </span>
          )}
          {/* Link indicator (any type of link) */}
          {isLinked && (
            <span className="pointer-events-none flex-shrink-0" title="Linked Column">
              <Link className="w-3 h-3 text-primary-400" />
            </span>
          )}

          {/* Column menu (same items as the universal table header) */}
          <DropdownMenu
            trigger={
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                aria-label={t('columnHeader.actions', { column: label })}
                className="nodrag relative flex h-5 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
              >
                <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
            items={menuItems}
          />
        </div>

        {/* Accordion - Data Preview */}
        {isExpanded && (
          <div id={previewId} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] border-t border-[var(--border-primary)]">
            <div className="flex-1 min-w-0">
              {rowsLoading ? (
                <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
              ) : previewData.length === 0 ? (
                <span className="text-xs text-[var(--text-tertiary)]">No data</span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {previewIndex + 1}/{previewData.length}
                  </span>
                  <span className="text-xs text-[var(--text-primary)] truncate font-mono">
                    {formattedPreviewValue.length > 50 ? formattedPreviewValue.slice(0, 50) + '...' : formattedPreviewValue}
                  </span>
                </div>
              )}
            </div>

            {/* Row stepper at the right edge: ↓ previous, ↑ next; then the close chevron under the row's toggle */}
            <button
              type="button"
              onClick={handlePrevRow}
              disabled={previewIndex === 0}
              className="nodrag p-0.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous row"
            >
              <ArrowDown className="w-3 h-3 text-[var(--text-secondary)]" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleNextRow}
              disabled={previewIndex >= previewData.length - 1}
              className="nodrag p-0.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next row"
            >
              <ArrowUp className="w-3 h-3 text-[var(--text-secondary)]" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={handleRowClick}
              aria-label={`Close preview ${label}`}
              className="nodrag flex h-5 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <span className="w-4 flex-shrink-0" aria-hidden="true" />
          </div>
        )}
      </div>
    );
  }
);

ColumnRow.displayName = 'ColumnRow';
