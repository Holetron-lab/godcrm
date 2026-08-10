import { useState, useMemo, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import {
  ACTIVE_PRESETS,
  presetRequiresTable as checkPresetRequiresTable,
  getPresetTables,
  hasAutoInit,
  getAutoInitEndpoint,
} from '@/features/widgets/config/widget-presets.config';
import type { TableMapping } from '@/features/widgets/components/TableMappingSelector';
import type {
  WidgetPresetOption,
  SpaceInfo,
  ProjectInfo,
  TableInfo,
  ColumnInfo,
  CreateWidgetPayload,
  WidgetCreateConfig,
  WizardStep,
} from './types';
import { transformConfigPreset } from './utils';

export function useWidgetCreate() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Get tableId from URL if coming from table context
  const tableIdFromUrl = searchParams.get('tableId');

  // State - New order: preset -> table/mapping -> config
  const [step, setStep] = useState<WizardStep>('preset');
  const [selectedPreset, setSelectedPreset] = useState<WidgetPresetOption | null>(null);
  // New: table mappings for multi-table widgets
  const [tableMappings, setTableMappings] = useState<TableMapping[]>([]);
  // Legacy: single table selection (for backwards compatibility)
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [widgetTitle, setWidgetTitle] = useState('');
  const [widgetIcon, setWidgetIcon] = useState<string | null>(null);
  // Visible columns for table_view (ordered array of column names)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  // Accordion state (legacy - for old table selector)
  const [expandedSpace, setExpandedSpace] = useState<number | null>(null);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  // Use presets from single source of truth (no API call needed)
  const widgetPresets = useMemo(() => {
    return ACTIVE_PRESETS.map(transformConfigPreset);
  }, []);

  // Helper function to check if preset requires table
  const presetRequiresTable = (presetId: string) => checkPresetRequiresTable(presetId);

  // Fetch all tables for mapping
  const { data: allTables } = useAllTables();

  // Fetch spaces
  const { data: spaces = [], isLoading: spacesLoading } = useQuery({
    queryKey: ['spaces'],
    queryFn: async () => {
      const response = await apiClient.request<{ data: SpaceInfo[] }>('/spaces');
      return response.data;
    },
    enabled: !tableIdFromUrl
  });

  // Fetch projects for expanded space
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', expandedSpace],
    queryFn: async () => {
      const response = await apiClient.request<{ data: ProjectInfo[] }>(`/projects?space_id=${expandedSpace}`);
      return response.data;
    },
    enabled: !!expandedSpace
  });

  // Fetch tables for expanded project
  const { data: tables = [], isLoading: tablesLoading } = useQuery({
    queryKey: ['tables', expandedProject],
    queryFn: async () => {
      const response = await apiClient.request<{ data: TableInfo[] }>(`/tables?project_id=${expandedProject}`);
      return response.data;
    },
    enabled: !!expandedProject
  });

  // Fetch table info if coming from URL
  const { data: tableFromUrl } = useQuery({
    queryKey: ['table', tableIdFromUrl],
    queryFn: async () => {
      const response = await apiClient.request<{ data: TableInfo }>(`/tables/${tableIdFromUrl}`);
      return response.data;
    },
    enabled: !!tableIdFromUrl
  });

  // Set table from URL on load
  useEffect(() => {
    if (tableFromUrl && !selectedTable) {
      setSelectedTable(tableFromUrl);
    }
  }, [tableFromUrl, selectedTable]);

  // Fetch columns for selected table
  const { data: columns = [], isLoading: columnsLoading } = useQuery({
    queryKey: ['table-columns', selectedTable?.id],
    queryFn: async () => {
      if (!selectedTable) return [];
      const response = await apiClient.request<{ data: ColumnInfo[] }>(`/tables/${selectedTable.id}/columns`);
      return response.data.map(col => ({
        ...col,
        id: String(col.id),
        type: col.type || col.column_type || 'text'
      }));
    },
    enabled: !!selectedTable
  });

  // Initialize visibleColumns with all columns when they load (for table_view preset)
  useEffect(() => {
    if (columns.length > 0 && visibleColumns.length === 0 && selectedPreset?.id === 'table_view') {
      const allColumnNames = columns
        .filter(col => !col.name.startsWith('_') && col.name !== 'id')
        .map(col => col.name);
      setVisibleColumns(allColumnNames);
    }
  }, [columns, selectedPreset]);

  // Get project ID from table mappings or URL
  const effectiveProjectId = useMemo(() => {
    if (projectId) return projectId;
    if (tableMappings.length > 0 && tableMappings[0].projectId) {
      return String(tableMappings[0].projectId);
    }
    if (tableMappings.length > 0 && tableMappings[0].tableId) {
      const tableId = tableMappings[0].tableId;
      const table = allTables?.flat?.find(t => String(t.id) === tableId);
      if (table) {
        return String(table.projectId);
      }
    }
    if (selectedTable) {
      return String(selectedTable.projectId || selectedTable.project_id);
    }
    return null;
  }, [projectId, tableMappings, allTables, selectedTable]);

  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError } = useQuery({
    queryKey: ['project-dashboard', effectiveProjectId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: { id: number } }>(`/projects/${effectiveProjectId}/dashboard`);
      return response.data;
    },
    enabled: !!effectiveProjectId
  });

  // Create widget mutation
  const createWidget = useMutation({
    mutationFn: async (data: CreateWidgetPayload) => {
      if (!effectiveProjectId) {
        throw new Error('No project selected. Please select a project or table first.');
      }
      if (dashboardLoading) {
        throw new Error('Dashboard is loading. Please wait...');
      }
      let dashboardId = dashboard?.id;
      if (!dashboardId) {
        logger.debug('Dashboard not found, attempting to create one for project:', effectiveProjectId);
        try {
          const dashboardResponse = await apiClient.request<{ data: { id: number } }>(`/projects/${effectiveProjectId}/dashboard`);
          dashboardId = dashboardResponse.data.id;
          logger.debug('Dashboard created/fetched successfully:', dashboardId);
        } catch (error) {
          logger.error('Failed to create/fetch dashboard:', error);
          throw new Error(`Failed to create dashboard for project ${effectiveProjectId}: ${error}`);
        }
      }
      if (!dashboardId) {
        throw new Error('Unable to create or find dashboard for this project');
      }
      const response = await apiClient.request<{ data: { id: number } }>(`/dashboards/${dashboardId}/widgets`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
      const widgetId = response?.data?.id;
      if (widgetId) {
        navigate(`/widgets/${widgetId}`);
      } else {
        navigate(-1);
      }
    }
  });

  // Auto-mapping logic - use column NAME not ID (for legacy single-table widgets)
  const autoMappedColumns = useMemo(() => {
    if (!selectedPreset || !columns.length) return {};
    const firstTable = selectedPreset.tables[0];
    if (!firstTable || firstTable.requiredColumns.length === 0) return {};

    const mapping: Record<string, string> = {};
    firstTable.requiredColumns.forEach(req => {
      const matchingColumn = columns.find(col =>
        req.types.includes(col.type) &&
        !Object.values(mapping).includes(col.name)
      );
      if (matchingColumn) {
        mapping[req.key] = matchingColumn.name;
      }
      if (!mapping[req.key]) {
        const nameMatch = columns.find(col => {
          const colName = (col.display_name || col.name).toLowerCase();
          const reqName = req.key.toLowerCase().replace('column', '');
          return colName.includes(reqName) || reqName.includes(colName);
        });
        if (nameMatch && req.types.includes(nameMatch.type)) {
          mapping[req.key] = nameMatch.name;
        }
      }
    });
    return mapping;
  }, [selectedPreset, columns]);

  // Initialize mapping when auto-mapping changes
  useMemo(() => {
    if (Object.keys(autoMappedColumns).length > 0 && Object.keys(columnMapping).length === 0) {
      setColumnMapping(autoMappedColumns);
    }
  }, [autoMappedColumns]);

  // Check if all required table mappings are complete
  const isTableMappingComplete = useMemo(() => {
    if (!selectedPreset || selectedPreset.tables.length === 0) return true;
    return selectedPreset.tables.every(tableReq => {
      if (!tableReq.required) return true;
      const mapping = tableMappings.find(m => m.tableKey === tableReq.key);
      if (!mapping) return false;
      if (mapping.createNew && tableReq.canCreate) return true;
      if (!mapping.tableId || mapping.tableId === 'undefined') return false;
      return tableReq.requiredColumns
        .filter(col => col.required)
        .every(col => mapping.columnMapping[col.key]);
    });
  }, [selectedPreset, tableMappings]);

  // Legacy: Check if required columns are mapped (for old single-table widgets)
  const allRequiredMapped = useMemo(() => {
    if (!selectedPreset) return true;
    const firstTable = selectedPreset.tables[0];
    if (!firstTable || firstTable.requiredColumns.length === 0) return true;
    return firstTable.requiredColumns
      .filter(c => c.required)
      .every(c => columnMapping[c.key]);
  }, [selectedPreset, columnMapping]);

  // Handlers
  const handleTableSelect = (table: TableInfo) => {
    setSelectedTable(table);
    setColumnMapping({});
    setStep('config');
  };

  const handlePresetSelect = (preset: WidgetPresetOption) => {
    setSelectedPreset(preset);
    setWidgetTitle(preset.name);
    const numericProjectId = projectId ? Number(projectId) : null;
    const initialMappings: TableMapping[] = preset.tables.map(req => ({
      tableKey: req.key,
      tableId: null,
      projectId: numericProjectId,
      columnMapping: {},
      createNew: req.canCreate,
    }));
    setTableMappings(initialMappings);
    if (!presetRequiresTable(preset.id)) {
      setStep('config');
    } else {
      setStep('table');
    }
  };

  const handleCreateWidget = async () => {
    const presetTables = selectedPreset ? getPresetTables(selectedPreset.id) : [];
    const requiresTable = presetTables.length > 0;

    if (!selectedPreset) {
      logger.error('Missing preset');
      return;
    }

    if (requiresTable && !isTableMappingComplete) {
      logger.error('Not all tables are mapped', {
        tableMappings,
        presetTables,
        isTableMappingComplete
      });
      alert('Ошибка: не все таблицы настроены. Проверьте маппинг колонок.');
      return;
    }

    // Create tables for mappings with createNew=true
    const updatedMappings = [...tableMappings];
    for (let i = 0; i < updatedMappings.length; i++) {
      const mapping = updatedMappings[i];
      if (mapping.createNew && mapping.projectId) {
        const tableReq = selectedPreset.tables.find(t => t.key === mapping.tableKey);
        if (!tableReq) continue;

        const columns = (tableReq.defaultColumns || []).map((col, idx) => ({
          name: col.name,
          displayName: col.displayName,
          type: col.type,
          order_index: idx + 1,
          is_required: col.required ? 1 : 0,
          config: col.options ? { options: col.options.map(o => ({ value: o, label: o })) } : null,
        }));

        try {
          const tableIcon = {
            documents: '📄',
            atoms: '⚛️',
            labs: '🧪',
            data: '🎫',
          }[tableReq.key] || '📋';

          interface CreatedColumn {
            id: number;
            column_name: string;
            display_name?: string;
            type: string;
          }

          const response = await apiClient.request<{ data: { table: { id: number }; columns: CreatedColumn[] } }>('/tables', {
            method: 'POST',
            body: JSON.stringify({
              name: tableReq.defaultTableName || tableReq.name,
              displayName: tableReq.defaultTableName || tableReq.name,
              project_id: mapping.projectId,
              icon: tableIcon,
              columns,
            }),
          });

          const createdTableId = response.data.table?.id;
          const createdColumns = response.data.columns || [];
          const autoColumnMapping: Record<string, string> = {};

          // Seed reference rows shipped with the preset (e.g. the SC-SIM block
          // catalog — ADR-165). The generic create path only builds schema, so a
          // preset whose table is a fixed reference set would otherwise come up
          // empty. Failures per row are logged but don't abort table creation.
          if (createdTableId && tableReq.seedRows?.length) {
            for (const seedRow of tableReq.seedRows) {
              try {
                await apiClient.request(`/tables/${createdTableId}/rows`, {
                  method: 'POST',
                  body: JSON.stringify({ data: seedRow }),
                });
              } catch (seedError) {
                logger.error(`Failed to seed row into "${tableReq.defaultTableName}":`, seedError);
              }
            }
          }

          tableReq.requiredColumns.forEach(reqCol => {
            const baseKey = reqCol.key.replace('Column', '').toLowerCase();
            const matchingCol = createdColumns.find(col =>
              col.column_name.toLowerCase() === baseKey ||
              col.column_name.toLowerCase().includes(baseKey)
            );
            if (matchingCol) {
              autoColumnMapping[reqCol.key] = matchingCol.column_name;
            }
          });

          updatedMappings[i] = {
            ...mapping,
            tableId: createdTableId ? String(createdTableId) : undefined,
            columnMapping: autoColumnMapping,
            createNew: false,
          };

          logger.debug(`Created table "${tableReq.defaultTableName}" with ID ${createdTableId}`, {
            columns: createdColumns.map(c => c.column_name),
            autoMapping: autoColumnMapping,
          });
        } catch (error) {
          logger.error(`Failed to create table "${tableReq.defaultTableName}":`, error);
          alert(`Ошибка создания таблицы "${tableReq.defaultTableName}": ${error}`);
          return;
        }
      }
    }

    setTableMappings(updatedMappings);

    // Build config from tableMappings
    const config: WidgetCreateConfig = {};
    updatedMappings.forEach(mapping => {
      const isValidTableId = mapping.tableId && mapping.tableId !== 'undefined' && mapping.tableId !== 'null';
      if (isValidTableId) {
        config[`${mapping.tableKey}_table_id`] = mapping.tableId;
        Object.entries(mapping.columnMapping).forEach(([colKey, colId]) => {
          config[`${mapping.tableKey}_${colKey}`] = colId;
        });
      }
    });

    // Legacy: Also set table_id for single-table presets
    const firstTableId = updatedMappings[0]?.tableId;
    const isValidFirstTableId = firstTableId && firstTableId !== 'undefined' && firstTableId !== 'null';
    if (updatedMappings.length === 1 && isValidFirstTableId) {
      config.table_id = firstTableId;
      Object.assign(config, updatedMappings[0].columnMapping);
    }

    // Find the selected table for legacy widget configs
    const legacySelectedTable = isValidFirstTableId
      ? allTables?.flat?.find(t => String(t.id) === firstTableId)
      : null;

    if (selectedPreset.id === 'table_view' && visibleColumns.length > 0) {
      config.visible_columns = visibleColumns;
    }

    if (selectedPreset.id === 'kanban_board' && updatedMappings[0]?.columnMapping.statusColumn) {
      const mapping = updatedMappings[0];
      config.kanban = {
        tableId: String(mapping.tableId),
        statusColumn: mapping.columnMapping.statusColumn,
        titleColumn: mapping.columnMapping.titleColumn,
        descriptionColumn: mapping.columnMapping.descriptionColumn,
        lanes: []
      };
    }

    if (selectedPreset.id === 'calendar_widget') {
      const mapping = updatedMappings[0];
      config.calendar = {
        tableId: String(mapping.tableId),
        dateColumn: mapping.columnMapping.dateColumn,
        endDateColumn: mapping.columnMapping.endDateColumn,
        titleColumn: mapping.columnMapping.titleColumn,
      };
    }

    if (selectedPreset.id === 'timeline_widget') {
      const mapping = updatedMappings[0];
      config.timeline = {
        tableId: String(mapping.tableId),
        startDateColumn: mapping.columnMapping.startDateColumn,
        endDateColumn: mapping.columnMapping.endDateColumn,
        titleColumn: mapping.columnMapping.titleColumn,
        groupByColumn: mapping.columnMapping.groupByColumn,
      };
    }

    if (selectedPreset.id === 'documents' || selectedPreset.id === 'documents_v4') {
      const docMapping = updatedMappings.find(m => m.tableKey === 'documents');
      config.project_id = docMapping?.projectId || (effectiveProjectId ? parseInt(String(effectiveProjectId)) : null);
      const documentsMapping = updatedMappings.find(m => m.tableKey === 'documents');
      const atomsMapping = updatedMappings.find(m => m.tableKey === 'atoms');
      if (documentsMapping?.tableId) {
        config.registry_table_id = parseInt(documentsMapping.tableId);
      }
      if (atomsMapping?.tableId) {
        config.atoms_table_id = parseInt(atomsMapping.tableId);
      }
    }

    if (selectedPreset.id === 'labs') {
      const labsMapping = updatedMappings.find(m => m.tableKey === 'labs');
      config.project_id = labsMapping?.projectId || (effectiveProjectId ? parseInt(String(effectiveProjectId)) : null);
      if (labsMapping?.tableId) {
        config.labs_table_id = parseInt(labsMapping.tableId);
      }
    }

    if (hasAutoInit(selectedPreset.id)) {
      const initEndpoint = getAutoInitEndpoint(selectedPreset.id);
      if (initEndpoint && effectiveProjectId) {
        try {
          const projectResponse = await apiClient.request<{ data: { space_id: number } }>(
            `/projects/${effectiveProjectId}`
          );
          const spaceId = projectResponse.data.space_id;
          if (spaceId) {
            const initResponse = await apiClient.request<{
              data: { lab_id: string; id: number; initialized?: boolean }
            }>(initEndpoint, {
              method: 'POST',
              body: JSON.stringify({
                space_id: spaceId,
                title: widgetTitle || selectedPreset.name,
              }),
            });
            if (selectedPreset.id === 'labs' && initResponse.data.lab_id) {
              config.labs_lab_id = initResponse.data.lab_id;
              config.labs_space_id = String(spaceId);
              logger.debug('Auto-initialized lab for Labs widget', {
                lab_id: initResponse.data.lab_id,
                space_id: spaceId
              });
            }
          }
        } catch (error) {
          logger.error('Failed to auto-initialize resource:', error);
        }
      }
    }

    await createWidget.mutateAsync({
      widget_type: 'preset',
      preset_name: selectedPreset.id,
      title: widgetTitle || selectedPreset.name,
      icon: widgetIcon || (
        selectedPreset.id === 'table_view' ? '📊' :
        selectedPreset.id === 'kanban_board' ? '📋' :
        selectedPreset.id === 'calendar_widget' ? '📅' :
        selectedPreset.id === 'timeline_widget' ? '📈' :
        selectedPreset.id === 'ai_agents' ? '🤖' : '📦'),
      config,
      position: { x: 0, y: 0, w: 12, h: 6 }
    });
  };

  // Get step names for progress
  const getSteps = () => {
    let steps = ['preset', 'table', 'config'];
    if (selectedPreset && !presetRequiresTable(selectedPreset.id)) {
      steps = steps.filter(s => s !== 'table');
    }
    return steps;
  };

  return {
    // Navigation
    navigate,
    projectId,
    // Step state
    step,
    setStep,
    // Preset
    selectedPreset,
    setSelectedPreset,
    widgetPresets,
    handlePresetSelect,
    presetRequiresTable,
    // Table
    selectedTable,
    setSelectedTable,
    handleTableSelect,
    tableMappings,
    setTableMappings,
    isTableMappingComplete,
    // Columns
    columns,
    columnsLoading,
    columnMapping,
    setColumnMapping,
    allRequiredMapped,
    // Visible columns
    visibleColumns,
    setVisibleColumns,
    // Widget config
    widgetTitle,
    setWidgetTitle,
    widgetIcon,
    setWidgetIcon,
    // Accordion (legacy)
    expandedSpace,
    setExpandedSpace,
    expandedProject,
    setExpandedProject,
    spaces,
    spacesLoading,
    projects,
    projectsLoading,
    tables,
    tablesLoading,
    // Dashboard
    effectiveProjectId,
    dashboard,
    dashboardLoading,
    dashboardError,
    // Create
    createWidget,
    handleCreateWidget,
    // Steps
    getSteps,
  };
}
