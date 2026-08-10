import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { Key, Link, ChevronUp, ChevronDown, Check } from 'lucide-react';
import type { ColumnData } from '../../types/schema-editor.types';
import { COLUMN_TYPE_METADATA, type ColumnType } from '@/shared/types';

// Get type icon from source of truth
const getTypeIcon = (type: string): string => {
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

// Column Row Sub-component with ref for position tracking
export interface ColumnRowProps {
  column: ColumnData;
  tableId: number;
  isSelected: boolean;
  linkType: 'none' | 'relation' | 'inverse'; // Type of link for coloring
  isPendingConnected: boolean; // Is this column part of a pending connection
  rowsPreview?: Record<string, any>[];  // Pre-loaded rows from parent
  rowsLoading?: boolean;  // Loading state from parent
  onSelect: () => void;
  onPositionUpdate: (columnName: string, top: number) => void;
  onOpenSettings?: (column: ColumnData) => void;
  onChangeType?: (column: ColumnData, newType: string) => void;
  onLoadRows?: () => void;  // Trigger loading rows if not yet loaded
}

export const ColumnRow = memo(
  ({ column, tableId, isSelected, linkType, isPendingConnected, rowsPreview, rowsLoading, onSelect, onPositionUpdate, onOpenSettings, onChangeType, onLoadRows }: ColumnRowProps) => {
    const rowRef = useRef<HTMLDivElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [showTypeSelector, setShowTypeSelector] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
      if (rowRef.current && hasLinkConfig(column)) {
        const rect = rowRef.current.getBoundingClientRect();
        const parentRect = rowRef.current.offsetParent?.getBoundingClientRect();
        if (parentRect) {
          const relativeTop = rect.top - parentRect.top + rect.height / 2;
          onPositionUpdate(column.name, relativeTop);
        }
      }
    }, [column.name, onPositionUpdate]);

    // Trigger loading rows when first expanded if not yet loaded
    useEffect(() => {
      if (isExpanded && rowsPreview === undefined && !rowsLoading && onLoadRows) {
        onLoadRows();
      }
    }, [isExpanded, rowsPreview, rowsLoading, onLoadRows, tableId]);

    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();
    };

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

    const handleNameClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        // Copy column key to clipboard
        navigator.clipboard.writeText(column.name).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }
    };

    const handleTypeClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowTypeSelector(!showTypeSelector);
    };

    const handleTypeSelect = (newType: string) => {
      setShowTypeSelector(false);
      if (onChangeType) {
        onChangeType(column, newType);
      }
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
    const displayIcon = icon || getTypeIcon(type);
    const isLinked = hasLinkConfig(column);

    const baseClasses = "relative flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-[var(--border-primary)] last:border-b-0 transition-all duration-150";

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

    const checkboxClasses = isSelected
      ? "bg-[var(--accent-primary)] border-[var(--accent-primary)]"
      : "border-[var(--border-secondary)] hover:border-[var(--accent-primary)]";

    // Get current preview value from rowsPreview
    const previewData = rowsPreview || [];
    const currentPreviewValue = previewData[previewIndex]?.[column.name];
    const formattedPreviewValue = currentPreviewValue !== undefined && currentPreviewValue !== null
      ? String(currentPreviewValue)
      : '—';

    return (
      <>
        <div
          ref={rowRef}
          onClick={handleRowClick}
          className={`${baseClasses} ${linkedHighlightClasses} ${selectedClasses} ${hoverClasses}`}
        >
          {/* Checkbox indicator - only this toggles selection */}
          <div
            onClick={handleCheckboxClick}
            className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${checkboxClasses}`}
          >
            {isSelected && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>

          {/* Icon - opens settings modal */}
          <span
            onClick={handleIconClick}
            className="text-sm flex-shrink-0 cursor-pointer hover:scale-110 transition-transform"
            title="Open column settings"
          >
            {displayIcon}
          </span>

          {/* Display name - Ctrl+click copies key */}
          <span
            onClick={handleNameClick}
            className="text-sm text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
            title={`${displayName || name} (Ctrl+Click to copy key)`}
          >
            {displayName || name}
            {copied && <Check className="w-3 h-3 inline ml-1 text-green-500" />}
          </span>

          {/* Key (column name) */}
          <span className="text-xs font-mono text-[var(--text-tertiary)] truncate">
            {name}
          </span>

          {/* Type label - clickable to change type */}
          <div className="relative ml-auto">
            <span
              onClick={handleTypeClick}
              className="text-xs font-mono text-[var(--text-tertiary)] flex-shrink-0 uppercase cursor-pointer hover:text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)] px-1 py-0.5 rounded transition-colors"
              title="Click to change type"
            >
              {type}
            </span>

            {/* Type selector dropdown - uses COLUMN_TYPE_METADATA as source of truth */}
            {showTypeSelector && (
              <div className="absolute right-0 top-full mt-1 z-50 w-32 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl max-h-64 overflow-y-auto">
                {Object.entries(COLUMN_TYPE_METADATA).map(([typeKey, meta]) => (
                  <button
                    key={typeKey}
                    onClick={(e) => { e.stopPropagation(); handleTypeSelect(typeKey); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)] transition-colors ${
                      type === typeKey ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {meta.labelEn}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* PK indicator */}
          {isPrimaryKey && (
            <span className="flex-shrink-0" title="Primary Key">
              <Key className="w-3 h-3 text-amber-500" />
            </span>
          )}
          {/* Link indicator (any type of link) */}
          {isLinked && (
            <span className="flex-shrink-0" title="Linked Column">
              <Link className="w-3 h-3 text-primary-400" />
            </span>
          )}

          {/* Expand indicator */}
          <span className="flex-shrink-0 text-[var(--text-tertiary)]">
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        </div>

        {/* Accordion - Data Preview */}
        {isExpanded && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)]">
            <button
              onClick={handlePrevRow}
              disabled={previewIndex === 0}
              className="p-0.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous row"
            >
              <ChevronDown className="w-3 h-3 text-[var(--text-secondary)]" />
            </button>

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

            <button
              onClick={handleNextRow}
              disabled={previewIndex >= previewData.length - 1}
              className="p-0.5 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next row"
            >
              <ChevronUp className="w-3 h-3 text-[var(--text-secondary)]" />
            </button>
          </div>
        )}
      </>
    );
  }
);

ColumnRow.displayName = 'ColumnRow';
