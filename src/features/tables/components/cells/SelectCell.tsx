import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnOption, ColumnRelationConfig } from '../../types/table.types';

interface SelectCellProps {
  value: unknown;
  options?: ColumnOption[];
  relation?: ColumnRelationConfig;
  rawMode?: boolean; // Show raw value without badge
}

// Цветовая палитра для опций без цвета (совпадает с SelectEditor)
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

export const SelectCell = ({ value, options = [], relation, rawMode }: SelectCellProps) => {
  // Load related table data if relation is enabled
  const { data: relationData } = useQuery({
    queryKey: ['select-cell-relation', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return new Map<string, { label: string; color?: string }>();
      }
      
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=5000`);
      
      const map = new Map<string, { label: string; color?: string }>();
      
      const rows = Array.isArray(response.data) 
        ? response.data 
        : (response.data as { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> }).rows || [];
      
      rows.forEach((row) => {
        const rowData = (row as { data?: Record<string, unknown> }).data || row;
        const rowId = (row as { id?: string | number }).id;
        const originalId = (row as { originalId?: string | number }).originalId;
        
        const label = String(rowData[relation.labelColumn] ?? '');
        const color = relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined;
        
        const itemData = { label, color };
        
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

  // RAW mode - show raw value without badge styling
  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }
  
  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)] italic text-sm">Select...</span>;
  }
  
  const stringValue = String(value);
  
  // Check relation data first (lookup from related table)
  if (relation?.enabled && relationData) {
    const relatedItem = relationData.get(stringValue);
    if (relatedItem) {
      const color = relatedItem.color || getDefaultColor(hashString(stringValue));
      return (
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
          style={{
            backgroundColor: `${color}20`,
            color: color,
            border: `1px solid ${color}40`
          }}
        >
          {relatedItem.label}
        </span>
      );
    }
  }
  
  const optionIndex = options.findIndex(opt => opt.value === value || opt.value === stringValue);
  const selectedOption = optionIndex >= 0 ? options[optionIndex] : null;
  
  // If option found in config, use its color
  if (selectedOption) {
    const color = selectedOption.color || getDefaultColor(optionIndex);
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
        style={{
          backgroundColor: `${color}20`,
          color: color,
          border: `1px solid ${color}40`
        }}
      >
        {selectedOption.label}
      </span>
    );
  }
  
  // If no options defined (external table) - show value as styled badge with auto-color
  const color = getDefaultColor(hashString(stringValue));
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`
      }}
    >
      {stringValue}
    </span>
  );
};
