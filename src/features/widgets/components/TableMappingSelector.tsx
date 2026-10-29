/**
 * TableMappingSelector - Component for mapping widget tables
 * Similar to relation column mapping in ColumnSettingsDrawer
 */

import { useId, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Plus } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import type { WidgetTableRequirement, WidgetTableColumn } from '../config/widget-presets.config';

interface TableMapping {
  tableKey: string;
  tableId: string | null;
  tableName?: string;
  projectId: number | null;
  columnMapping: Record<string, string>;
  createNew?: boolean;
}

interface TableMappingSelectorProps {
  /** Table requirements from widget preset */
  tableRequirements: WidgetTableRequirement[];
  /** Current mappings */
  mappings: TableMapping[];
  /** Callback when mappings change */
  onMappingsChange: (mappings: TableMapping[]) => void;
  /** Default project ID (from URL or context) */
  defaultProjectId?: number;
}

interface ColumnInfo {
  id: string;
  name: string;
  display_name?: string;
  type?: string;
  column_type?: string;
}

// Local types for API responses
interface TableData {
  id: string | number;
  name: string;
  displayName?: string;
  icon?: string;
  projectId?: number;
}

interface ProjectData {
  id: number;
  name: string;
  icon?: string;
  tables?: TableData[];
}

interface SpaceData {
  id: number;
  name: string;
  icon?: string;
  projects: ProjectData[];
}

interface AllTablesData {
  spaces?: SpaceData[];
  spacesWithTables?: SpaceData[];
  flat?: TableData[];
}

export function TableMappingSelector({
  tableRequirements,
  mappings,
  onMappingsChange,
  defaultProjectId,
}: TableMappingSelectorProps) {
  const { data: allTablesData } = useAllTables();
  
  // Initialize mappings for each required table
  useEffect(() => {
    if (tableRequirements.length > 0 && mappings.length === 0) {
      const initialMappings: TableMapping[] = tableRequirements.map(req => ({
        tableKey: req.key,
        tableId: null,
        projectId: defaultProjectId || null,
        columnMapping: {},
        createNew: false,
      }));
      onMappingsChange(initialMappings);
    }
  }, [tableRequirements, mappings.length, defaultProjectId, onMappingsChange]);
  
  // Update mappings with defaultProjectId when it becomes available
  // (handles case when projectId from URL wasn't available on first render)
  useEffect(() => {
    if (defaultProjectId && mappings.length > 0) {
      // Check if any mapping is missing projectId but should have it
      const needsUpdate = mappings.some(m => m.projectId === null);
      if (needsUpdate) {
        const updatedMappings = mappings.map(m => ({
          ...m,
          projectId: m.projectId || defaultProjectId,
        }));
        onMappingsChange(updatedMappings);
      }
    }
  }, [defaultProjectId, mappings, onMappingsChange]);
  
  const updateMapping = (tableKey: string, updates: Partial<TableMapping>) => {
    const newMappings = mappings.map(m => 
      m.tableKey === tableKey ? { ...m, ...updates } : m
    );
    onMappingsChange(newMappings);
  };

  return (
    <div className="space-y-6">
      {tableRequirements.map((req, index) => {
        const mapping = mappings.find(m => m.tableKey === req.key) || {
          tableKey: req.key,
          tableId: null,
          projectId: defaultProjectId || null,
          columnMapping: {},
        };
        
        return (
          <TableMappingCard
            key={req.key}
            requirement={req}
            mapping={mapping}
            allTablesData={allTablesData}
            index={index}
            onUpdate={(updates) => updateMapping(req.key, updates)}
          />
        );
      })}
    </div>
  );
}

interface TableMappingCardProps {
  requirement: WidgetTableRequirement;
  mapping: TableMapping;
  allTablesData: AllTablesData | undefined;
  index: number;
  onUpdate: (updates: Partial<TableMapping>) => void;
}

function TableMappingCard({
  requirement,
  mapping,
  allTablesData,
  index,
  onUpdate,
}: TableMappingCardProps) {
  const fieldId = useId();
  // Get tables for selected project (search through spaces → projects → tables)
  const projectTables = useMemo(() => {
    if (!mapping.projectId || !allTablesData?.spaces) return [];
    
    // Search in all spaces for the project
    for (const space of allTablesData.spaces) {
      const project = space.projects?.find((p: ProjectData) => p.id === mapping.projectId);
      if (project) {
        return project.tables || [];
      }
    }
    
    // Fallback: search in flat tables list
    if (allTablesData.flat) {
      return allTablesData.flat.filter((t: TableData) => t.projectId === mapping.projectId);
    }
    
    return [];
  }, [mapping.projectId, allTablesData]);
  
  // Fetch columns when table is selected
  const { data: tableColumns = [], isLoading: loadingColumns, isError: columnsError } = useQuery({
    queryKey: ['table-columns-mapping', mapping.tableId],
    queryFn: async () => {
      if (!mapping.tableId) return [];
      const response = await apiClient.request<{ data: ColumnInfo[] }>(
        `/tables/${mapping.tableId}/columns`
      );
      return response.data || [];
    },
    enabled: !!mapping.tableId,
  });
  
  // Filter columns by type for each required column
  const getCompatibleColumns = (requiredTypes: string[]) => {
    return tableColumns.filter((col: ColumnInfo) => {
      const colType = col.type || col.column_type || '';
      return requiredTypes.includes(colType) || requiredTypes.length === 0;
    });
  };
  
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      {/* Header - no accordion */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: 'var(--color-primary-500)', color: 'white' }}
          >
            {index + 1}
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <Database className="w-4 h-4" />
              {requirement.name}
              {requirement.required && <span className="text-red-500">*</span>}
            </h4>
            <p className="text-xs text-[var(--text-secondary)]">
              {requirement.description}
            </p>
          </div>
        </div>
        
        {/* Toggle switch for canCreate tables */}
        {requirement.canCreate && (
          <div className="flex items-center gap-2 bg-[var(--bg-tertiary)] rounded-lg p-1">
            <button
              onClick={() => onUpdate({ createNew: false, tableId: null, columnMapping: {} })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !mapping.createNew 
                  ? 'bg-blue-700 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Существующая
            </button>
            <button
              onClick={() => onUpdate({ createNew: true, tableId: null, columnMapping: {} })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mapping.createNew 
                  ? 'bg-green-700 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              + Создать
            </button>
          </div>
        )}
      </div>
      
      {/* Content */}
      <div className="space-y-3">
        {mapping.createNew ? (
          /* Create new table mode */
          <div className="grid grid-cols-2 gap-3">
            {/* Project selector */}
            <div>
              <label htmlFor={`${fieldId}-0`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Проект
              </label>
              <select id={`${fieldId}-0`}
                value={mapping.projectId ? String(mapping.projectId) : ''}
                onChange={(e) => onUpdate({
                  projectId: e.target.value ? Number(e.target.value) : null,
                })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
              >
                <option value="">— Выберите проект —</option>
                {(allTablesData?.spaces || []).map((space: SpaceData) => (
                  <optgroup key={space.id} label={`${space.icon || '🏢'} ${space.name}`}>
                    {space.projects.map((project: ProjectData) => (
                      <option key={project.id} value={String(project.id)}>
                        {project.icon || '📂'} {project.name} ({project.id})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            
            {/* New table name display */}
            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Новая таблица
              </span>
              <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-400 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                {requirement.defaultTableName || requirement.name}
              </div>
            </div>
          </div>
        ) : (
          /* Select existing table mode - use spacesWithTables (only projects with tables) */
          <>
            <div className="grid grid-cols-2 gap-3">
              {/* Project selector */}
              <div>
                <label htmlFor={`${fieldId}-1`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Проект
                </label>
                <select id={`${fieldId}-1`}
                  value={mapping.projectId ? String(mapping.projectId) : ''}
                  onChange={(e) => onUpdate({
                    projectId: e.target.value ? Number(e.target.value) : null,
                    tableId: null,
                    columnMapping: {},
                  })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                >
                  <option value="">— Выберите проект —</option>
                  {(allTablesData?.spacesWithTables || allTablesData?.spaces || []).map((space: SpaceData) => (
                    <optgroup key={space.id} label={`${space.icon || '🏢'} ${space.name}`}>
                      {space.projects.map((project: ProjectData) => (
                        <option key={project.id} value={String(project.id)}>
                          {project.icon || '📂'} {project.name} ({project.id})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              
              {/* Table selector */}
              <div>
                <label htmlFor={`${fieldId}-2`} className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Таблица
                </label>
                <select id={`${fieldId}-2`}
                  value={mapping.tableId || ''}
                  onChange={(e) => {
                    // Guard against invalid values like 'undefined' or empty string
                    const selectedValue = e.target.value;
                    const isValidValue = selectedValue && selectedValue !== 'undefined' && selectedValue !== 'null';
                    onUpdate({
                      tableId: isValidValue ? selectedValue : null,
                      tableName: isValidValue 
                        ? projectTables.find((t: TableData) => String(t.id) === selectedValue)?.displayName
                        : undefined,
                      columnMapping: {},
                    });
                  }}
                  disabled={!mapping.projectId}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] disabled:opacity-50"
                >
                  <option value="">— Выберите таблицу —</option>
                  {projectTables
                    .filter((table: TableData) => table.id !== undefined && table.id !== null)
                    .map((table: TableData) => (
                    <option key={table.id} value={String(table.id)}>
                      {table.icon || '📋'} {table.displayName} ({table.id}) — {table.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Column mapping */}
            {mapping.tableId && mapping.tableId !== 'undefined' && requirement.requiredColumns.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--border-secondary)]">
                <h5 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                  Маппинг колонок
                </h5>
                <div className="space-y-2">
                  {requirement.requiredColumns.map((reqCol) => {
                    const compatibleColumns = getCompatibleColumns(reqCol.types);
                    
                    return (
                      <div key={reqCol.key} className="grid grid-cols-2 gap-3 items-center">
                        <div className="text-sm text-[var(--text-primary)]">
                          {reqCol.name}
                          {reqCol.required && <span className="text-red-500 ml-1">*</span>}
                          <p className="text-xs text-[var(--text-secondary)]">
                            {reqCol.description}
                          </p>
                        </div>
                        <select
                          aria-label={reqCol.name}
                          disabled={loadingColumns || columnsError}
                          value={mapping.columnMapping[reqCol.key] || ''}
                          onChange={(e) => onUpdate({
                            columnMapping: {
                              ...mapping.columnMapping,
                              [reqCol.key]: e.target.value,
                            },
                          })}
                          className="min-w-0 w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                        >
                          <option value="">{loadingColumns ? 'Загрузка колонок…' : columnsError ? 'Не удалось загрузить колонки' : '— Выберите колонку —'}</option>
                          {compatibleColumns.map((col: ColumnInfo) => (
                            <option key={col.id} value={col.name}>
                              {col.display_name || col.name} ({col.type || col.column_type})
                            </option>
                          ))}
                          {reqCol.key === 'assigneeColumn' && (
                            <option value="__create_assignee__">+ Создать колонку «Assignee», если её нет</option>
                          )}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type { TableMapping };
