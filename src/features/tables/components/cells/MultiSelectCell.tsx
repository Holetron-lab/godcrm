import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnOption, ColumnRelationConfig } from '../../types/table.types';

interface MultiSelectCellProps {
  value: unknown;
  options?: ColumnOption[];
  relation?: ColumnRelationConfig;  // Can link to table for dynamic options
  rawMode?: boolean;
}

// Цветовая палитра для авто-цветов
const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

// Simple hash function to get consistent color for a value
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

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
  color?: string;
}

export const MultiSelectCell = ({ value, options = [], relation, rawMode }: MultiSelectCellProps) => {
  // Load related table data if relation is enabled
  const { data: relationData } = useQuery({
    queryKey: ['multi-select-cell-relation', relation?.tableId, relation?.valueColumn, relation?.labelColumn, relation?.colorColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return new Map<string, RelatedItemData>();
      }
      
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=5000`);
      
      const map = new Map<string, RelatedItemData>();
      
      const rows = Array.isArray(response.data) 
        ? response.data 
        : (response.data as { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> }).rows || [];
      
      rows.forEach((row) => {
        const rowData = (row as { data?: Record<string, unknown> }).data || row;
        const rowId = (row as { id?: string | number }).id;
        const originalId = (row as { originalId?: string | number }).originalId;
        
        const label = String(rowData[relation.labelColumn] ?? '');
        const color = relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined;
        
        const itemData: RelatedItemData = { label, color };
        
        // Map by different possible ID fields
        if (relation.valueColumn === 'id') {
          if (originalId !== undefined && originalId !== null) {
            map.set(String(originalId), itemData);
          }
          if (rowData['id'] !== undefined && rowData['id'] !== null) {
            map.set(String(rowData['id']), itemData);
          }
          if (rowId !== undefined && rowId !== null) {
            map.set(String(rowId), itemData);
          }
        } else {
          const val = String(rowData[relation.valueColumn] ?? '');
          map.set(val, itemData);
        }
      });
      
      return map;
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
  });

  // RAW mode - show comma-separated values
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    const values = parseValues(value, relation?.storageFormat);
    const rawValue = values.join(', ');
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {rawValue || 'NULL'}
      </span>
    );
  }

  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
  }
  
  // Parse values
  const values = parseValues(value, relation?.storageFormat);
  
  if (values.length === 0) {
    return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
  }

  // Get display data for each value
  const items = values.map((val, index) => {
    // Check relation data first (lookup from related table)
    if (relation?.enabled && relationData) {
      const relatedItem = relationData.get(val);
      if (relatedItem) {
        return {
          value: val,
          label: relatedItem.label,
          color: relatedItem.color || getDefaultColor(hashString(val))
        };
      }
    }
    
    // Check local options
    const optionIndex = options.findIndex(opt => opt.value === val);
    const selectedOption = optionIndex >= 0 ? options[optionIndex] : null;
    
    if (selectedOption) {
      return {
        value: val,
        label: selectedOption.label,
        color: selectedOption.color || getDefaultColor(optionIndex)
      };
    }
    
    // Fallback - use value as label with auto-color
    return {
      value: val,
      label: val,
      color: getDefaultColor(hashString(val) + index)
    };
  });

  // Display mode (from relation config or default to 'badges')
  const displayMode = relation?.displayMode || 'badges';

  // === COUNT MODE ===
  if (displayMode === 'count') {
    return (
      <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium">
        {items.length}
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

  // === FIRST ONLY MODE ===
  if (displayMode === 'first' && items.length > 0) {
    const first = items[0];
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
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

  // === BADGES MODE (default) - круглые карточки ===
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, index) => (
        <span
          key={index}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
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
};
