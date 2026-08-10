import { useQuery } from '@tanstack/react-query';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { SafeHtml } from '@/shared/components/SafeHtml';
import { apiClient } from '@/shared/utils/apiClient';
import type { TextColumnConfig, ColumnRelationConfig } from '../../types/table.types';

interface TextCellProps {
  value: unknown;
  rawMode?: boolean;
  cellFormat?: {
    mode?: 'text' | 'html' | 'markdown' | 'formula';
  };
  textConfig?: TextColumnConfig;
  relation?: ColumnRelationConfig;
  rowData?: Record<string, unknown>;
  /** Callback for inline content updates (enables interactive checkboxes in markdown mode) */
  onValueChange?: (newValue: string) => void;
}

// Replace {{variable}} placeholders with values from rowData
// Supports system variables: {{row_id}}, {{value}}
const replaceVariables = (template: string, rowData: Record<string, unknown>): string => {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Handle system variables
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    // Regular column value
    const value = rowData[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
};

export const TextCell = ({ value, rawMode, cellFormat, textConfig, relation, rowData = {}, onValueChange }: TextCellProps) => {
  // Load related table data if relation is enabled
  const { data: relationData } = useQuery({
    queryKey: ['text-cell-relation', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return new Map<string, string>();
      }
      
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=5000`);
      
      const map = new Map<string, string>();
      
      const rows = Array.isArray(response.data) 
        ? response.data 
        : (response.data as { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> }).rows || [];
      
      rows.forEach((row) => {
        const rowData = (row as { data?: Record<string, unknown> }).data || row;
        const rowId = (row as { id?: string | number }).id;
        const originalId = (row as { originalId?: string | number }).originalId;
        
        const label = String(rowData[relation.labelColumn] ?? '');
        
        if (relation.valueColumn === 'id') {
          if (originalId !== undefined && originalId !== null) {
            map.set(String(originalId), label);
          }
          if (rowData['id'] !== undefined && rowData['id'] !== null) {
            map.set(String(rowData['id']), label);
          }
          if (rowId !== undefined && rowId !== null) {
            map.set(String(rowId), label);
          }
        } else {
          const val = String(rowData[relation.valueColumn] ?? '');
          map.set(val, label);
        }
      });
      
      return map;
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
  });

  // RAW mode - show data as-is with NULL for empty
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  // Calculate display value
  let displayValue: string;
  
  // If formula is set, use it to compute the value
  if (textConfig?.formula) {
    displayValue = replaceVariables(textConfig.formula, rowData);
  } else if (relation?.enabled && relationData && value !== null && value !== undefined && value !== '') {
    // If relation is enabled, try to get label from related table
    const label = relationData.get(String(value));
    displayValue = label || String(value);
  } else {
    // Use the cell value directly
    if (value === null || value === undefined || value === '') {
      // Even empty values can have prefix/suffix
      if (!textConfig?.prefix && !textConfig?.suffix) {
        return <span className="text-[var(--text-tertiary)] italic">Empty</span>;
      }
      displayValue = '';
    } else {
      displayValue = String(value);
    }
  }
  
  // Apply prefix and suffix (they can also contain variables)
  const prefix = textConfig?.prefix ? replaceVariables(textConfig.prefix, rowData) : '';
  const suffix = textConfig?.suffix ? replaceVariables(textConfig.suffix, rowData) : '';
  
  const finalValue = `${prefix}${displayValue}${suffix}`;
  
  // If final value is empty after all processing
  if (!finalValue.trim()) {
    return <span className="text-[var(--text-tertiary)] italic">Empty</span>;
  }
  
  // HTML mode - render HTML content (sanitized for XSS protection)
  if (cellFormat?.mode === 'html') {
    return (
      <SafeHtml 
        html={finalValue} 
        className="text-sm prose prose-sm max-w-none dark:prose-invert"
      />
    );
  }
  
  // Markdown mode - render Markdown content
  if (cellFormat?.mode === 'markdown') {
    return (
      <MarkdownPreview
        content={finalValue}
        className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        onContentChange={onValueChange}
      />
    );
  }
  
  return (
    <span className="text-sm">
      {finalValue}
    </span>
  );
};
