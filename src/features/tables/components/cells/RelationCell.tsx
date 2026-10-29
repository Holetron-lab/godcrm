import { ExternalLink, Table2, Plus } from 'lucide-react';
import type { ColumnRelationConfig } from '../../types/table.types';
import { parseRelationValues, resolveLens, type LensedValue } from '../../utils/resolveLens';
import { colorForKey, useRelationLookup } from '../../hooks/useRelationLookup';

interface RelationCellProps {
  value: unknown;
  relation?: ColumnRelationConfig;
  /** ADR-205: lens resolved by renderCellValue from the server map; absent → client lookup. */
  lensed?: LensedValue;
  rawMode?: boolean;
  rowId?: string | number; // Current row ID for reverse lookups
  onOpenNestedTable?: (tableId: string, filterColumn: string, filterValue: string, config?: ColumnRelationConfig['nested']) => void;
  onNavigateToRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
}

export const RelationCell = ({ value, relation, lensed, rawMode, rowId, onOpenNestedTable, onNavigateToRow }: RelationCellProps) => {
  const isReverseMode = relation?.lookupMode === 'reverse';

  // Normal mode: the server map (via renderCellValue) covers the lookup, the shared client
  // fetch is the fallback. Reverse mode needs the whole related table → always the client fetch.
  const { relationMap, reverseLookup } = useRelationLookup(relation, { enabled: isReverseMode || !lensed?.mapped });
  const lens = lensed?.mapped ? lensed : resolveLens(value, relation, relationMap, 'auto');
  const reverseItems = isReverseMode ? reverseLookup(rowId) : [];

  // RAW mode
  if (rawMode || relation?.displayMode === 'raw') {
    if (isReverseMode) {
      if (reverseItems.length === 0) {
        return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
      }
      return (
        <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
          {reverseItems.map(i => i.label).join(', ')}
        </span>
      );
    }
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
        {String(value)}
      </span>
    );
  }

  // Reverse mode: use reverseItems instead of value lookup
  if (isReverseMode) {
    const displayMode = relation?.displayMode || 'badges';
    
    if (reverseItems.length === 0) {
      return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
    }
    
    // Badges mode (default)
    if (displayMode === 'badges' || displayMode === 'tags') {
      return (
        <div className="flex flex-wrap gap-1 max-w-full">
          {reverseItems.map((item, index) => (
            <button
              type="button"
              disabled={!onNavigateToRow || !relation?.tableId}
              key={index}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-[var(--text-primary)] cursor-pointer hover:opacity-80 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
              style={{
                backgroundColor: `${item.color}20`,
                border: `1px solid ${item.color}40`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (onNavigateToRow && relation?.tableId) {
                  onNavigateToRow(relation.tableId, item.value);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      );
    }
    
    // List mode
    if (displayMode === 'list') {
      return (
        <span className="text-sm text-[var(--text-primary)]">
          {reverseItems.map(i => i.label).join(', ')}
        </span>
      );
    }
    
    // Count mode
    if (displayMode === 'count') {
      return (
        <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium">
          {reverseItems.length}
        </span>
      );
    }
    
    // Default: badges
    return (
      <div className="flex flex-wrap gap-1">
        {reverseItems.map((item, index) => (
          <span
            key={index}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: `${item.color}20`,
              color: item.color,
              border: `1px solid ${item.color}40`
            }}
          >
            {item.label}
          </span>
        ))}
      </div>
    );
  }

  // Empty value (normal mode) - show + button
  if (value === null || value === undefined || value === '') {
    return (
      <div className="flex items-center gap-1 text-[var(--text-tertiary)]">
        <Plus className="w-4 h-4 opacity-50" />
        <span className="italic text-sm">—</span>
      </div>
    );
  }

  // Parse multiple values
  const values = parseRelationValues(value, relation?.storageFormat);
  const displayMode = relation?.displayMode || 'badges';

  // Get items data (unresolved keys render as the raw key — D1.5)
  const lensByKey = new Map(lens.items.map((item) => [item.key, item]));
  const items = values.map((v, index) => {
    const related = lensByKey.get(v);
    return {
      value: v,
      label: (related?.resolved && related.label) || v,
      description: related?.description,
      color: related?.color || colorForKey(v, index)
    };
  });

  // === NESTED TABLE MODE ===
  if (relation?.type === 'nested' && relation?.nested) {
    const buttonLabel = relation.nested.buttonLabel || 'Показать записи';
    const buttonIcon = relation.nested.buttonIcon;
    
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (onOpenNestedTable && relation.tableId) {
            onOpenNestedTable(
              relation.tableId, 
              relation.nested!.filterColumn, 
              String(value),
              relation.nested
            );
          }
        }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
      >
        {buttonIcon ? <span>{buttonIcon}</span> : <Table2 className="w-3.5 h-3.5" />}
        {buttonLabel}
      </button>
    );
  }

  // === COUNT MODE ===
  if (displayMode === 'count') {
    return (
      <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium">
        {items.length}
      </span>
    );
  }

  // === FIRST ONLY MODE ===
  if (displayMode === 'first' && items.length > 0) {
    const first = items[0];
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
        style={{
          backgroundColor: `${first.color}20`,
          color: first.color,
          border: `1px solid ${first.color}40`
        }}
      >
        {first.label}
        {items.length > 1 && (
          <span className="ml-1 opacity-60">+{items.length - 1}</span>
        )}
      </span>
    );
  }

  // === LIST MODE ===
  if (displayMode === 'list') {
    return (
      <span className="text-sm text-[var(--text-primary)]">
        {items.map(i => i.label).join(', ')}
      </span>
    );
  }

  // === CARDS MODE ===
  if (displayMode === 'cards') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <button
            type="button"
            disabled={!onNavigateToRow || !relation?.tableId}
            key={index}
            className="flex flex-col px-2.5 py-1.5 rounded border text-xs text-left text-[var(--text-primary)] cursor-pointer hover:shadow-sm transition-shadow disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
            style={{
              backgroundColor: `${item.color}10`,
              borderColor: `${item.color}30`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (onNavigateToRow && relation?.tableId) {
                onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
          >
            <span className="font-medium hover:underline">
              {item.label}
            </span>
            {item.description && (
              <span className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-tight">
                {item.description}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  // === BADGES MODE (default) ===
  return (
    <div className="group/relation relative flex flex-wrap gap-1 pr-6 min-h-[24px]">
      {items.map((item, index) => (
        <button
          type="button"
          disabled={!onNavigateToRow || !relation?.tableId}
          key={index}
          onClick={(e) => {
            e.stopPropagation();
            if (onNavigateToRow && relation?.tableId) {
              onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          className="group inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-[var(--text-primary)] hover:shadow-sm transition-shadow cursor-pointer disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
          style={{
            backgroundColor: `${item.color}20`,
            border: `1px solid ${item.color}40`
          }}
          title={item.description || `Открыть: ${item.value}`}
        >
          {item.label}
          <ExternalLink aria-hidden="true" className="w-3 h-3 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" />
        </button>
      ))}
      {/* Add button - positioned at bottom right */}
      <span 
        aria-hidden="true"
        className="absolute right-0 bottom-0 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] cursor-pointer transition-opacity opacity-30 group-hover/relation:opacity-100 group-focus-within/relation:opacity-100"
      >
        <Plus className="w-3.5 h-3.5" />
      </span>
    </div>
  );
};
