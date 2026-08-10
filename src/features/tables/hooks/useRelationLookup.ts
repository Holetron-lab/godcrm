/**
 * useRelationLookup - Universal hook for loading relation data
 * 
 * Loads data from related table and provides lookup function
 * to resolve IDs to labels with colors.
 * 
 * Usage:
 *   const { lookup, isLoading } = useRelationLookup(relation);
 *   const item = lookup(value); // { label: 'backlog', color: '#6b7280' }
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnRelationConfig } from '../types/table.types';

export interface RelationItem {
  label: string;
  color?: string;
  description?: string;
}

// Default color palette
const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
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

export function useRelationLookup(relation?: ColumnRelationConfig) {
  const { data: relationMap, isLoading } = useQuery({
    queryKey: ['relation-lookup', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return new Map<string, RelationItem>();
      }
      
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=5000`);
      
      const map = new Map<string, RelationItem>();
      
      const rows = Array.isArray(response.data) 
        ? response.data 
        : (response.data as { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> }).rows || [];
      
      rows.forEach((row) => {
        const rowData = (row as { data?: Record<string, unknown> }).data || row;
        const rowId = (row as { id?: string | number }).id;
        const originalId = (row as { originalId?: string | number }).originalId;
        
        // Get label - try both column name and column ID format
        const label = String(
          rowData[relation.labelColumn] ?? 
          rowData['name'] ?? 
          rowData['title'] ?? 
          ''
        );
        
        // Get color if colorColumn specified
        const color = relation.colorColumn 
          ? String(rowData[relation.colorColumn] ?? rowData['color'] ?? '') || undefined 
          : (rowData['color'] ? String(rowData['color']) : undefined);
        
        // Get description if descriptionColumn specified
        const description = relation.descriptionColumn 
          ? String(rowData[relation.descriptionColumn] ?? '') || undefined 
          : undefined;
        
        const itemData: RelationItem = { label, color, description };
        
        // Add to map by different possible keys
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
          // Custom valueColumn (e.g., system_user_id)
          const val = rowData[relation.valueColumn];
          if (val !== undefined && val !== null) {
            map.set(String(val), itemData);
          }
        }
      });
      
      return map;
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
  });

  /**
   * Lookup value and return RelationItem with label and color
   */
  const lookup = (value: unknown): RelationItem | null => {
    if (value === null || value === undefined || value === '') return null;
    if (!relationMap) return null;
    
    const stringValue = String(value);
    const item = relationMap.get(stringValue);
    
    if (item) {
      return {
        ...item,
        color: item.color || getDefaultColor(hashString(stringValue))
      };
    }
    
    return null;
  };

  /**
   * Get all items from the relation table
   */
  const getAllItems = (): Array<{ value: string } & RelationItem> => {
    if (!relationMap) return [];
    return Array.from(relationMap.entries()).map(([value, item]) => ({
      value,
      ...item
    }));
  };

  return {
    lookup,
    getAllItems,
    isLoading,
    relationMap
  };
}

/**
 * Helper to parse relation config from column config
 */
export function parseRelationConfig(config: unknown): ColumnRelationConfig | undefined {
  if (!config) return undefined;
  
  const parsed = typeof config === 'string' ? JSON.parse(config) : config;
  
  if (parsed?.relation?.enabled) {
    return {
      enabled: true,
      tableId: parsed.relation.tableId || parsed.relatedTableId,
      valueColumn: parsed.relation.valueColumn || 'id',
      labelColumn: parsed.relation.labelColumn || parsed.displayColumn || 'name',
      colorColumn: parsed.relation.colorColumn || 'color',
      descriptionColumn: parsed.relation.descriptionColumn
    };
  }
  
  // Legacy format: just relatedTableId
  if (parsed?.relatedTableId) {
    return {
      enabled: true,
      tableId: String(parsed.relatedTableId),
      valueColumn: 'id',
      labelColumn: parsed.displayColumn || 'name',
      colorColumn: 'color'
    };
  }
  
  return undefined;
}
