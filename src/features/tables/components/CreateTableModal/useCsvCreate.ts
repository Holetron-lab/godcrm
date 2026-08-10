import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { tablesApi } from '../../api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import { useCreateTable } from '../../hooks/useCreateTable';
import { extractNotionId, isGeneratedId, getIdFromNameId, convertValue } from './notion-utils';
import type { CSVFileData, CSVColumnDefinition } from './types';
import type { CreateTablePayload } from '../../types/table.types';

interface UseCsvCreateParams {
  csvFiles: CSVFileData[];
  csvFilesBeforeNotionImport: CSVFileData[] | null;
  targetProjectId: number | null;
  useFirstRowAsHeaders: boolean;
  setCsvCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCsvStep: React.Dispatch<React.SetStateAction<'upload' | 'configure' | 'creating'>>;
  resetState: () => void;
  onOpenChange: (open: boolean) => void;
  // For handleSubmit:
  tableType: 'local' | 'external' | 'csv';
  basic: { displayName: string; name: string; description: string; icon: string; color: string };
  derivedName: string;
  hierarchy: any;
  columns: any[];
  selectedDataSource: string;
  selectedExternalTable: string;
  selectedRelatedTables: string[];
  showInMenu: boolean;
  menuWidgetTitle: string;
  menuWidgetIcon: string;
  menuWidgetDescription: string;
  slugify: (value: string) => string;
}

export function useCsvCreate(params: UseCsvCreateParams) {
  const {
    csvFiles,
    csvFilesBeforeNotionImport,
    targetProjectId,
    useFirstRowAsHeaders,
    setCsvCreating,
    setCsvStep,
    resetState,
    onOpenChange,
    tableType,
    basic,
    derivedName,
    hierarchy,
    columns,
    selectedDataSource,
    selectedExternalTable,
    selectedRelatedTables,
    showInMenu,
    menuWidgetTitle,
    menuWidgetIcon,
    menuWidgetDescription,
    slugify,
  } = params;

  const { t } = useLanguage();
  const createTable = useCreateTable();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleCsvCreate = useCallback(async () => {
    if (csvFiles.length === 0 || !targetProjectId) {
      return;
    }

    setCsvCreating(true);
    setCsvStep('creating');

    // Map: csvFileId -> table info for relation linking
    const tableInfoMap = new Map<string, {
      tableId: number;
      notionIdToRowId: Map<string, string>; // notion_id -> row_id
      nameToNotionId: Map<string, string>; // name -> notion_id (for matching by name)
      columnDefinitions?: typeof csvFiles[0]['columnDefinitions'];
      relationDataMap?: Map<string, Map<number, string[]>>; // colName -> rowIdx -> notion_ids[]
      rowIdxToRowId?: Map<number, string>; // rowIdx -> row_id
    }>();

    // PHASE 0: Build global Name -> NotionID mapping from all files
    // Use ORIGINAL data (before processNotionImport) to extract URLs
    // ONLY for items with REAL Notion URLs - for accurate relation matching
    const globalNameToNotionId = new Map<string, { notionId: string; fileId: string }>();

    logger.debug('=== PHASE 0: Building name -> notion_id mapping ===');
    logger.debug('csvFilesBeforeNotionImport available:', csvFilesBeforeNotionImport !== null);

    for (const csvFile of csvFiles) {
      // Try to use original data first (it contains the Notion URLs)
      const originalFile = csvFilesBeforeNotionImport?.find(f => f.id === csvFile.id);

      // Find notion_id column index in current (transformed) file
      const notionIdColIdx = csvFile.columnDefinitions.findIndex(c => c.name === 'notion_id');
      // Find name column - usually the column after notion_id, or first column
      const nameColIdx = notionIdColIdx !== -1 ? notionIdColIdx + 1 : 0;

      logger.debug(`Processing file: ${csvFile.tableDisplayName}`);
      logger.debug(`  notionIdColIdx: ${notionIdColIdx}, nameColIdx: ${nameColIdx}`);

      const currentDataRows = useFirstRowAsHeaders ? csvFile.data.slice(1) : csvFile.data;
      let mappedCount = 0;

      if (originalFile) {
        // Strategy 1: Use original data with Notion URLs
        logger.debug(`  Using original data (${originalFile.data.length} rows)`);
        const dataRows = useFirstRowAsHeaders ? originalFile.data.slice(1) : originalFile.data;

        dataRows.forEach((row, rowIdx) => {
          const firstCell = row[0] || '';
          // Extract REAL notion_id from first column (only if has URL)
          const notionId = extractNotionId(firstCell);
          // Get clean name (without URL)
          const name = firstCell.replace(/\s*\(https?:\/\/[^)]+\)\s*/g, '').trim();

          // Debug first 3 rows
          if (rowIdx < 3) {
            logger.debug(`  Row ${rowIdx}: firstCell="${firstCell.substring(0, 80)}...", name="${name}", notionId=${notionId}`);
          }

          // ONLY add to mapping if we found a REAL Notion ID (from URL)
          if (name && notionId && !isGeneratedId(notionId)) {
            globalNameToNotionId.set(name.toLowerCase(), { notionId, fileId: csvFile.id });
            globalNameToNotionId.set(name, { notionId, fileId: csvFile.id });
            mappedCount++;
          }
        });
      } else if (notionIdColIdx !== -1) {
        // Strategy 2: Use transformed data with notion_id column
        logger.debug(`  Using transformed data with notion_id column (${currentDataRows.length} rows)`);

        currentDataRows.forEach((row, rowIdx) => {
          const notionIdValue = row[notionIdColIdx] || '';
          const name = row[nameColIdx] || '';
          // Extract pure ID from name-id format
          const pureId = getIdFromNameId(notionIdValue);

          if (rowIdx < 3) {
            logger.debug(`  Row ${rowIdx}: notionId="${notionIdValue}", pureId="${pureId}", name="${name}"`);
          }

          // Add to mapping if we have both name and valid notion_id (supports name-id format)
          if (name && pureId && /^[a-f0-9]{32}$/i.test(pureId)) {
            // Store with full name-id value for later use
            globalNameToNotionId.set(name.toLowerCase(), { notionId: notionIdValue, fileId: csvFile.id });
            globalNameToNotionId.set(name, { notionId: notionIdValue, fileId: csvFile.id });
            mappedCount++;
          }
        });
      } else {
        logger.warn(`  No original data and no notion_id column for ${csvFile.tableDisplayName}`);
      }

      logger.debug(`  File ${csvFile.tableDisplayName}: ${mappedCount} names mapped to notion_ids`);
    }

    logger.debug(`Built global name mapping: ${globalNameToNotionId.size / 2} entries with REAL Notion IDs`);
    // Debug: log first 10 entries
    let debugCount = 0;
    globalNameToNotionId.forEach((val, key) => {
      if (debugCount < 20) {
        logger.debug(`  Name mapping: "${key}" -> ${val.notionId} (file: ${val.fileId})`);
        debugCount++;
      }
    });

    try {
      // PHASE 1: Create all tables with notion_id column and import data
      for (const csvFile of csvFiles) {
        // 1. Create table
        const tableResponse = await tablesApi.createTable({
          name: csvFile.tableName,
          displayName: csvFile.tableDisplayName,
          description: t('tables.create.importedFromNotion').replace('{file}', csvFile.fileName),
          icon: csvFile.icon || '📊',
          projectId: targetProjectId
        });

        const newTableId = tableResponse.table.id;

        if (csvFile.showInMenu) {
          try {
            const widgetTitle = csvFile.menuWidgetTitle.trim() || csvFile.tableDisplayName || csvFile.tableName;
            const widgetIcon = csvFile.menuWidgetIcon || csvFile.icon || '📊';
            const widgetDescription =
              csvFile.menuWidgetDescription.trim() || csvFile.tableDescription || undefined;
            const dashboardResponse = await apiClient.request<{ data: { id: number } }>(
              `/projects/${targetProjectId}/dashboard`
            );
            await apiClient.request(`/dashboards/${dashboardResponse.data.id}/widgets`, {
              method: 'POST',
              body: JSON.stringify({
                widget_type: 'preset',
                preset_name: 'table_view',
                title: widgetTitle,
                icon: widgetIcon,
                description: widgetDescription,
                config: { table_id: newTableId },
                position: { x: 0, y: 0, w: 12, h: 6 }
              })
            });
            queryClient.invalidateQueries({ queryKey: ['project-widgets', targetProjectId] });
            queryClient.invalidateQueries({ queryKey: ['widgets'] });
          } catch (widgetError) {
            logger.error('Failed to create widget from CSV:', widgetError);
          }
        }
        // 2. Create columns (notion_id is already in columnDefinitions after Notion Import)
        // For relation columns, create as text first - will be updated with notion_ids in row data
        // Skip excluded columns
        for (const col of csvFile.columnDefinitions.filter(c => !c.excluded)) {
          if (col.name === 'id') continue;

          const isRelationColumn = col.isNotionRelation || col.type === 'relation';

          // For select columns, extract unique options from data
          let columnConfig: Record<string, unknown> | undefined;
          let columnType = col.type;

          // Relation columns: create as text first to store notion_ids, convert to relation in PHASE 2
          if (isRelationColumn) {
            columnType = 'text'; // Store as text initially, will update config in PHASE 2
          } else if (col.type === 'select') {
            const colIdx = csvFile.headers.indexOf(col.csvColumn);
            const dataRows = useFirstRowAsHeaders ? csvFile.data.slice(1) : csvFile.data;
            const uniqueOptions = new Set<string>();

            dataRows.forEach(row => {
              const cellValue = row[colIdx] || '';
              // Split by comma for multi-select values
              cellValue.split(',').forEach(v => {
                const trimmed = v.trim();
                if (trimmed) uniqueOptions.add(trimmed);
              });
            });

            // Check if this is a "relation select" - options match names from another table
            let matchedTargetFileId: string | undefined;
            let matchCount = 0;
            const optionsArray = Array.from(uniqueOptions);

            optionsArray.forEach(opt => {
              const mapping = globalNameToNotionId.get(opt) || globalNameToNotionId.get(opt.toLowerCase());
              if (mapping) {
                matchedTargetFileId = matchedTargetFileId || mapping.fileId;
                if (mapping.fileId === matchedTargetFileId) matchCount++;
              }
            });

            // If >30% of options match a table, it's a relation select
            if (matchCount >= optionsArray.length * 0.3 && matchedTargetFileId) {
              const targetTableInfo = tableInfoMap.get(matchedTargetFileId);
              if (targetTableInfo) {
                // Configure as relation with source - use notion_id for matching
                columnConfig = {
                  relation: {
                    enabled: true,
                    tableId: String(targetTableInfo.tableId),
                    valueColumn: 'notion_id',
                    labelColumn: 'name'
                  }
                };
                logger.debug(`Relation select ${col.name}: linked to table ${targetTableInfo.tableId} (${matchCount}/${optionsArray.length} matches)`);
              }
            } else {
              // Regular select with options
              const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];
              const options = optionsArray.slice(0, 50).map((label, idx) => ({
                label,
                value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                color: colors[idx % colors.length]
              }));

              columnConfig = { options };
              logger.debug(`Select column ${col.name}: ${options.length} options`);
            }
          }

          // Create the column
          try {
            await tablesApi.createColumn(String(newTableId), {
              name: col.name,
              displayName: col.displayName,
              type: columnType,
              ...(columnConfig ? { config: columnConfig } : {})
            });
          } catch (err) {
            logger.warn(`Failed to create column ${col.name}:`, err);
          }
        }

        // 3. Prepare rows data - notion_id is already in the data from processNotionImport
        // For relation columns, data already contains notion_ids (extracted in processNotionImport)
        // For names without URLs, we try to map them via globalNameToNotionId
        const dataRows = useFirstRowAsHeaders ? csvFile.data.slice(1) : csvFile.data;

        // Build relation data map: colName -> rowIdx -> notion_ids[]
        const relationDataMap = new Map<string, Map<number, string[]>>();

        // Ensure headers is a valid array
        const headers = Array.isArray(csvFile.headers) ? csvFile.headers : [];

        const rows = dataRows.map((row, rowIdx) => {
          const obj: Record<string, unknown> = {};

          headers.forEach((header, i) => {
            const def = csvFile.columnDefinitions.find(d => d.csvColumn === header);
            // Skip excluded columns
            if (!def || def.name === 'id' || def.excluded) return;

            const isRelationColumn = def.isNotionRelation || def.type === 'relation';
            if (isRelationColumn) {
              // For relation columns, data contains either NAMES or NOTION_IDs
              // depending on user's selected mode
              const currentValue = row[i] || '';

              // Parse values based on format (json, semicolon, comma)
              let values: string[] = [];
              const trimmedValue = currentValue.trim();

              if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
                // JSON array format
                try {
                  const parsed = JSON.parse(trimmedValue);
                  if (Array.isArray(parsed)) {
                    values = parsed.map(v => String(v).trim()).filter(v => v);
                  }
                } catch {
                  // Fall through to string split
                }
              }

              if (values.length === 0) {
                // Split by comma or semicolon
                values = currentValue.split(/[,;]/).map(n => n.trim()).filter(n => n);
              }

              const relNotionIds: string[] = [];

              if (rowIdx < 3) {
                logger.debug(`Relation ${def.name} row ${rowIdx}: raw value = "${currentValue.substring(0, 100)}..."`);
                logger.debug(`  Parsed values: ${values.slice(0, 5).join(', ')}`);
              }

              values.forEach(val => {
                // First check if val is already a notion_id (32-char hex) or name-id format
                const pureId = getIdFromNameId(val);
                if (/^[a-f0-9]{32}$/i.test(pureId)) {
                  // Direct notion_id (or name-id format) - use original value to preserve name
                  relNotionIds.push(val);
                  if (rowIdx < 3) {
                    logger.debug(`  "${val}": used directly as notion_id`);
                  }
                } else {
                  // Map via name
                  const mapping = globalNameToNotionId.get(val) || globalNameToNotionId.get(val.toLowerCase());
                  if (mapping) {
                    if (!def.relationTargetFileId || mapping.fileId === def.relationTargetFileId) {
                      relNotionIds.push(mapping.notionId);
                      if (rowIdx < 3) {
                        logger.debug(`  "${val}": mapped to ${mapping.notionId}`);
                      }
                    } else if (rowIdx < 3) {
                      logger.debug(`  "${val}": found but fileId mismatch (${mapping.fileId} vs ${def.relationTargetFileId})`);
                    }
                  } else if (rowIdx < 3) {
                    logger.debug(`  "${val}": NOT FOUND in globalNameToNotionId`);
                  }
                }
              });

              // Store values in row data using configured storage format
              if (relNotionIds.length > 0) {
                const storageFormat = def.relationStorageFormat || 'comma';
                let storedValue: string;
                switch (storageFormat) {
                  case 'json':
                    storedValue = JSON.stringify(relNotionIds);
                    break;
                  case 'semicolon':
                    storedValue = relNotionIds.join('; ');
                    break;
                  case 'single':
                    storedValue = relNotionIds[0];
                    break;
                  case 'comma':
                  default:
                    storedValue = relNotionIds.join(', ');
                }
                obj[def.name] = storedValue;
                logger.debug(`Relation ${def.name} row ${rowIdx}: ${relNotionIds.length} notion_ids, format: ${storageFormat}`);

                // Also store for PHASE 2 (to update column config)
                if (!relationDataMap.has(def.name)) {
                  relationDataMap.set(def.name, new Map());
                }
                relationDataMap.get(def.name)!.set(rowIdx, relNotionIds);
              } else if (values.length > 0) {
                // No notion_ids found, but we have original values - store them as-is
                // This preserves data even if relation mapping fails
                obj[def.name] = currentValue;
                logger.debug(`Relation ${def.name} row ${rowIdx}: no notion_ids found, storing raw value`);
              }
            } else if (def.name === 'notion_id') {
              // notion_id is already in the data - use it directly
              obj['notion_id'] = row[i] || '';
            } else {
              obj[def.name] = convertValue(row[i], def.type);
            }
          });

          return obj;
        });

        // 4. Import rows
        await tablesApi.importRows(String(newTableId), {
          rows,
          mode: 'add',
          idMapping: null,
          addNewIds: true
        });

        // 5. Build notion_id -> row_id mapping and store relation data
        const tableRows = await tablesApi.getRows(String(newTableId), 1, 10000);
        const notionIdToRowId = new Map<string, string>();
        const rowIdxToRowId = new Map<number, string>(); // for relation updates
        const nameToNotionId = new Map<string, string>();

        if (tableRows.rows && Array.isArray(tableRows.rows)) {
          tableRows.rows.forEach((row: { row_id: string; notion_id?: string; name?: string; [key: string]: unknown }, idx: number) => {
            rowIdxToRowId.set(idx, row.row_id);
            if (row.notion_id) {
              notionIdToRowId.set(row.notion_id, row.row_id);
              // Also build name -> notion_id for this table
              if (row.name && typeof row.name === 'string') {
                nameToNotionId.set(row.name, row.notion_id);
                nameToNotionId.set(row.name.toLowerCase(), row.notion_id);
              }
            }
          });
        }

        tableInfoMap.set(csvFile.id, {
          tableId: newTableId,
          notionIdToRowId,
          nameToNotionId,
          columnDefinitions: csvFile.columnDefinitions,
          relationDataMap, // Store for PHASE 2
          rowIdxToRowId // Store for PHASE 2
        });

        logger.debug(`Created table ${csvFile.tableDisplayName}: ${tableRows.rows?.length || 0} rows, ${notionIdToRowId.size} notion IDs mapped`);
      }

      // PHASE 2: Create relation columns with notion_id mapping
      for (const csvFile of csvFiles) {
        const sourceInfo = tableInfoMap.get(csvFile.id);
        if (!sourceInfo) continue;

        // Get columns of this table to find column IDs
        const tableColumns = await tablesApi.getColumns(String(sourceInfo.tableId));
        const columnNameToId = new Map<string, string>();
        if (tableColumns && Array.isArray(tableColumns)) {
          tableColumns.forEach((col: { id: number; name?: string; column_name?: string }) => {
            const colName = col.name || col.column_name;
            if (colName) {
              columnNameToId.set(colName, String(col.id));
            }
          });
        }

        for (const col of csvFile.columnDefinitions) {
          const isRelationColumn = col.isNotionRelation || col.type === 'relation';
          if (!isRelationColumn || !col.relationTargetFileId) continue;

          const targetInfo = tableInfoMap.get(col.relationTargetFileId);
          if (!targetInfo) continue;

          const columnId = columnNameToId.get(col.name);
          if (!columnId) {
            logger.warn(`Column ${col.name} not found in table`);
            continue;
          }

          // Use configured columns or find best defaults
          const targetColumns = targetInfo.columnDefinitions || [];

          // Value column - use configured or default to notion_id
          const valueColumn = col.relationValueColumn || 'notion_id';

          // Label column - use configured or find best default
          let labelColumn = col.relationLabelColumn;
          if (!labelColumn) {
            const nameCol = targetColumns.find(c => c.name === 'name' || c.name === 'title');
            if (nameCol) {
              labelColumn = nameCol.name;
            } else {
              const firstTextCol = targetColumns.find(c => c.type === 'text' && c.name !== 'notion_id');
              labelColumn = firstTextCol?.name || 'name';
            }
          }

          // Storage format - use configured or default to comma
          const storageFormat = col.relationStorageFormat || 'comma';

          // Update the column to relation type with proper config
          try {
            await tablesApi.updateColumn(String(sourceInfo.tableId), columnId, {
              type: 'relation',
              config: {
                relatedTableId: targetInfo.tableId,
                relationType: 'many-to-many',
                storageFormat: storageFormat,
                relation: {
                  enabled: true,
                  tableId: String(targetInfo.tableId),
                  valueColumn: valueColumn,
                  labelColumn: labelColumn,
                  storageFormat: storageFormat
                }
              }
            });
            logger.debug(`Updated column ${col.name} to relation type, target table ${targetInfo.tableId}, valueColumn: ${valueColumn}, labelColumn: ${labelColumn}, storageFormat: ${storageFormat}`);
          } catch (err) {
            logger.warn(`Failed to update relation column ${col.name}:`, err);
          }
        }
      }

      // 7. Refetch tables data and navigate to first created table
      const firstTableInfo = tableInfoMap.values().next().value;

      // Use refetchQueries instead of invalidateQueries to wait for data update
      await queryClient.refetchQueries({ queryKey: ['project-tables', targetProjectId] });
      await queryClient.refetchQueries({ queryKey: ['tables'] });

      // Small delay to ensure store is updated
      await new Promise(resolve => setTimeout(resolve, 100));

      resetState();
      onOpenChange(false);

      if (firstTableInfo) {
        navigate(`/tables/${firstTableInfo.tableId}`);
      }
    } catch (err) {
      logger.error('CSV create error:', err);
      setCsvStep('configure');
    } finally {
      setCsvCreating(false);
    }
  }, [csvFiles, csvFilesBeforeNotionImport, targetProjectId, useFirstRowAsHeaders, queryClient, onOpenChange, navigate, resetState]);

  const handleSubmit = async () => {
    // Handle CSV creation separately
    if (tableType === 'csv') {
      handleCsvCreate();
      return;
    }

    if (!basic.displayName.trim() || createTable.isLoading) {
      return;
    }

    if (tableType === 'external' && (!selectedDataSource || !selectedExternalTable)) {
      return;
    }

    const payload: CreateTablePayload = {
      name: derivedName,
      displayName: basic.displayName.trim(),
      description: basic.description?.trim() || undefined,
      icon: basic.icon || '📋',
      color: basic.color,
      hierarchy,
      projectId: targetProjectId ?? undefined,
      ...(tableType === 'external' ? {
        data_source_id: selectedDataSource,
        external_table_name: selectedExternalTable
      } : {
        columns: columns.map((column, index) => ({
          ...column,
          name: column.name || slugify(`${column.displayName}-${index + 1}`),
          displayName: column.displayName?.trim() || `Column ${index + 1}`,
          config: column.config,
          mapping: column.mapping
        }))
      })
    };

    // Create main table
    createTable.mutate(payload, {
      onSuccess: async (data) => {
        const createdTableId = data?.table?.id ? Number(data.table.id) : null;
        const createdProjectId = data?.table?.projectId ?? targetProjectId ?? null;

        if (showInMenu && createdTableId && createdProjectId) {
          try {
            const dashboardResponse = await apiClient.request<{ data: { id: number } }>(
              `/projects/${createdProjectId}/dashboard`
            );
            await apiClient.request(`/dashboards/${dashboardResponse.data.id}/widgets`, {
              method: 'POST',
              body: JSON.stringify({
                widget_type: 'preset',
                preset_name: 'table_view',
                title: menuWidgetTitle.trim() || basic.displayName.trim() || data?.table?.displayName || data?.table?.name || t('tables.create.tableDefault'),
                icon: menuWidgetIcon || basic.icon || '📋',
                description: menuWidgetDescription.trim() || basic.description?.trim() || undefined,
                config: { table_id: createdTableId },
                position: { x: 0, y: 0, w: 12, h: 6 }
              })
            });
            queryClient.invalidateQueries({ queryKey: ['project-widgets', createdProjectId] });
            queryClient.invalidateQueries({ queryKey: ['widgets'] });
          } catch (error) {
            logger.error('Failed to create menu widget:', error);
          }
        }

        // Create related tables if selected
        if (tableType === 'external' && selectedRelatedTables.length > 0) {
          for (const relatedTable of selectedRelatedTables) {
            try {
              const relatedPayload: CreateTablePayload = {
                name: relatedTable.replace(/[^a-z0-9_]/gi, '_'),
                displayName: relatedTable,
                description: t('tables.create.linkedTableFor').replace('{name}', basic.displayName),
                icon: '🔗',
                projectId: targetProjectId ?? undefined,
                data_source_id: selectedDataSource,
                external_table_name: relatedTable
              };
              await createTable.mutateAsync(relatedPayload);
            } catch (error) {
              logger.error(`Failed to create related table ${relatedTable}:`, error);
            }
          }
        }
        resetState();
        onOpenChange(false);
      }
    });
  };

  return { handleCsvCreate, handleSubmit, createTable };
}
