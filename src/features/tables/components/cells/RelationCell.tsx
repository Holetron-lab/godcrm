import { useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Table2, Plus } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnRelationConfig } from '../../types/table.types';

interface RelationCellProps {
  value: unknown;
  relation?: ColumnRelationConfig;
  rawMode?: boolean;
  rowId?: string | number; // Current row ID for reverse lookups
  onOpenNestedTable?: (tableId: string, filterColumn: string, filterValue: string, config?: ColumnRelationConfig['nested']) => void;
  onNavigateToRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
}

// Цветовая палитра для бейджей
const defaultColors = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

// Parse value to array based on storage format
const parseValues = (value: unknown, storageFormat?: string): string[] => {
  if (value === null || value === undefined || value === '') return [];
  
  const stringValue = String(value);
  
  // Try JSON parse first
  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v)).filter(Boolean);
      }
    } catch {
      // Not valid JSON, continue with other formats
    }
  }
  
  // Based on storage format
  switch (storageFormat) {
    case 'comma':
      return stringValue.split(',').map(v => v.trim()).filter(Boolean);
    case 'semicolon':
      return stringValue.split(';').map(v => v.trim()).filter(Boolean);
    case 'newline':
      return stringValue.split('\n').map(v => v.trim()).filter(Boolean);
    case 'single':
      return [stringValue];
    case 'json':
    default:
      // Auto-detect
      if (stringValue.includes(',')) {
        return stringValue.split(',').map(v => v.trim()).filter(Boolean);
      }
      if (stringValue.includes(';')) {
        return stringValue.split(';').map(v => v.trim()).filter(Boolean);
      }
      if (stringValue.includes('\n')) {
        return stringValue.split('\n').map(v => v.trim()).filter(Boolean);
      }
      return [stringValue];
  }
};

interface RelatedItemData {
  label: string;
  description?: string;
  color?: string;
}

export const RelationCell = ({ value, relation, rawMode, rowId, onOpenNestedTable, onNavigateToRow }: RelationCellProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const isReverseMode = relation?.lookupMode === 'reverse';
  
  // Load related table data (normal mode: lookup by value, reverse mode: find rows where column contains our rowId)
  const { data: relationData } = useQuery({
    queryKey: ['relation-cell-data', relation?.tableId, relation?.valueColumn, relation?.labelColumn, relation?.descriptionColumn, isReverseMode, rowId],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return { map: new Map<string, RelatedItemData>(), reverseItems: [] as Array<{ value: string; label: string; description?: string; color?: string }> };
      }
      
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=5000`);
      
      const map = new Map<string, RelatedItemData>();
      const reverseItems: Array<{ value: string; label: string; description?: string; color?: string }> = [];
      
      const rows = Array.isArray(response.data) 
        ? response.data 
        : (response.data as { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> }).rows || [];
      
      rows.forEach((row, index) => {
        const rowData = (row as { data?: Record<string, unknown> }).data || row;
        const sourceRowId = (row as { id?: string | number }).id;
        const originalId = (row as { originalId?: string | number }).originalId;
        
        // Helper to get value by column id or column name
        const getColumnValue = (colKey: string) => {
          // Try direct key first
          if (rowData[colKey] !== undefined) return rowData[colKey];
          // For local tables, data might have column names as keys
          // Check common column names
          if (colKey === 'name' || colKey === 'label' || colKey === 'title') {
            return rowData['name'] ?? rowData['label'] ?? rowData['title'];
          }
          if (colKey === 'agent_id') return rowData['agent_id'];
          // Try to find in row itself
          if (row && typeof row === 'object' && (row as Record<string, unknown>)[colKey] !== undefined) {
            return (row as Record<string, unknown>)[colKey];
          }
          return undefined;
        };
        
        const label = String(getColumnValue(relation.labelColumn) ?? rowData['name'] ?? '');
        const description = relation.descriptionColumn ? String(getColumnValue(relation.descriptionColumn) ?? '') || undefined : undefined;
        const color = relation.colorColumn ? String(getColumnValue(relation.colorColumn) ?? '') || getDefaultColor(index) : getDefaultColor(index);
        
        const itemData: RelatedItemData = { label, description, color };
        
        // Reverse mode: find rows where valueColumn contains our rowId
        if (isReverseMode && rowId !== undefined) {
          // Try to get value by column id or column name
          let columnValue = getColumnValue(relation.valueColumn);
          // Also try common column names for agent relation
          if (columnValue === undefined) {
            columnValue = rowData['agent_id'] ?? rowData['user_id'] ?? rowData['parent_id'];
          }
          const columnValues = parseValues(columnValue, relation.storageFormat);
          const rowIdStr = String(rowId);
          logger.debug('[RelationCell] checking row:', { 
            sourceRowId, label, columnValue, columnValues, rowIdStr, 
            match: columnValues.includes(rowIdStr),
            rowData: JSON.stringify(rowData).substring(0, 200)
          });
          if (columnValues.includes(rowIdStr)) {
            reverseItems.push({
              value: String(sourceRowId ?? originalId ?? ''),
              label: label || 'Без имени',
              description,
              color
            });
          }
        }
        
        // Normal mode: build lookup map
        if (relation.valueColumn === 'id') {
          if (originalId !== undefined && originalId !== null) {
            map.set(String(originalId), itemData);
          }
          if (rowData['id'] !== undefined && rowData['id'] !== null) {
            map.set(String(rowData['id']), itemData);
          }
          if (sourceRowId !== undefined && sourceRowId !== null) {
            map.set(String(sourceRowId), itemData);
          }
        } else {
          // Use getColumnValue for both column_name and column_id formats
          const val = getColumnValue(relation.valueColumn);
          if (val !== undefined && val !== null && val !== '') {
            map.set(String(val), itemData);
          }
        }
      });
      
      logger.debug('[RelationCell] reverse lookup:', { 
        rowId, 
        isReverseMode, 
        reverseItemsCount: reverseItems.length, 
        reverseItems: reverseItems.slice(0, 3) 
      });
      return { map, reverseItems };
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
  });
  
  // Debug logging
  logger.debug('[RelationCell] render:', { 
    rowId, 
    isReverseMode, 
    hasRelationData: Boolean(relationData),
    reverseItemsCount: relationData?.reverseItems?.length || 0
  });

  // RAW mode
  if (rawMode || relation?.displayMode === 'raw') {
    if (isReverseMode) {
      const reverseItems = relationData?.reverseItems || [];
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
    const reverseItems = relationData?.reverseItems || [];
    const displayMode = relation?.displayMode || 'badges';
    
    if (reverseItems.length === 0) {
      return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
    }
    
    // Badges mode (default)
    if (displayMode === 'badges' || displayMode === 'tags') {
      return (
        <div 
          className="flex flex-wrap gap-1 max-w-full"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {reverseItems.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80"
              style={{
                backgroundColor: `${item.color}20`,
                color: item.color,
                border: `1px solid ${item.color}40`
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (onNavigateToRow && relation?.tableId) {
                  onNavigateToRow(relation.tableId, item.value);
                }
              }}
            >
              {item.label}
            </span>
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
  const values = parseValues(value, relation?.storageFormat);
  const displayMode = relation?.displayMode || 'badges';
  
  // Get items data
  const items = values.map((v, index) => {
    const itemData = relationData?.map?.get(v);
    return {
      value: v,
      label: itemData?.label || v,
      description: itemData?.description,
      color: itemData?.color || getDefaultColor(hashString(v) + index)
    };
  });

  // === NESTED TABLE MODE ===
  if (relation?.type === 'nested' && relation?.nested) {
    const buttonLabel = relation.nested.buttonLabel || 'Показать записи';
    const buttonIcon = relation.nested.buttonIcon;
    
    return (
      <button
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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all bg-[var(--color-primary-500)]/10 text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20 border border-[var(--color-primary-500)]/30"
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
          <div
            key={index}
            className="flex flex-col px-2.5 py-1.5 rounded border text-xs cursor-pointer hover:shadow-sm transition-shadow"
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
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                if (onNavigateToRow && relation?.tableId) {
                  onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
                }
              }
            }}
          >
            <span className="font-medium hover:underline" style={{ color: item.color }}>
              {item.label}
            </span>
            {item.description && (
              <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-tight">
                {item.description}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // === BADGES MODE (default) ===
  return (
    <div 
      className="relative flex flex-wrap gap-1 pr-6 min-h-[24px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {items.map((item, index) => (
        <span
          key={index}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (onNavigateToRow && relation?.tableId) {
              onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              if (onNavigateToRow && relation?.tableId) {
                onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
              }
            }
          }}
          className="group inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium hover:shadow-sm transition-shadow cursor-pointer"
          style={{
            backgroundColor: `${item.color}20`,
            color: item.color,
            border: `1px solid ${item.color}40`
          }}
          title={item.description || `Открыть: ${item.value}`}
        >
          {item.label}
          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60" />
        </span>
      ))}
      {/* Add button - positioned at bottom right */}
      <span 
        className="absolute right-0 bottom-0 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] cursor-pointer transition-opacity"
        style={{ opacity: isHovered ? 1 : 0.3 }}
      >
        <Plus className="w-3.5 h-3.5" />
      </span>
    </div>
  );
};
