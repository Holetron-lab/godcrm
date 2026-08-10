import { useCallback } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { logger } from '@/shared/utils/logger';
import {
  extractNotionId, extractNotionUrls, extractAllNotionIds,
  generateLocalId, isGeneratedId, getIdFromNameId,
  toNotionKey, parseNotionRelation, isNotionRelationColumn, convertValue
} from './notion-utils';
import type { CSVFileData, CSVColumnDefinition, NotionImportLogEntry } from './types';
import { useApplyNotionTransform } from './useApplyNotionTransform';

interface UseNotionImportParams {
  csvFiles: CSVFileData[];
  setCsvFiles: React.Dispatch<React.SetStateAction<CSVFileData[]>>;
  useFirstRowAsHeaders: boolean;
  currentCsvFileIndex: number;
  csvFilesBeforeNotionImport: CSVFileData[] | null;
  setCsvFilesBeforeNotionImport: React.Dispatch<React.SetStateAction<CSVFileData[] | null>>;
  notionImportLog: NotionImportLogEntry[];
  setNotionImportLog: React.Dispatch<React.SetStateAction<NotionImportLogEntry[]>>;
  expandedColumns: Set<number>;
  setExpandedColumns: React.Dispatch<React.SetStateAction<Set<number>>>;
  notionValueDisplay: 'names' | 'notion_id';
  notionOutputFormat: 'comma' | 'json' | 'semicolon';
  notionCreateIdColumn: boolean;
  notionNameColumnMap: Record<string, string>;
  setNotionImportPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useNotionImport(params: UseNotionImportParams) {
  const {
    csvFiles,
    setCsvFiles,
    useFirstRowAsHeaders,
    currentCsvFileIndex,
    csvFilesBeforeNotionImport,
    setCsvFilesBeforeNotionImport,
    notionImportLog,
    setNotionImportLog,
    expandedColumns,
    setExpandedColumns,
    notionValueDisplay,
    notionOutputFormat,
    notionCreateIdColumn,
    notionNameColumnMap,
    setNotionImportPanelVisible,
  } = params;

  const { t } = useLanguage();

  // Process Notion Import - detect relations, clean data, add notion_id column, and prepare for row_id linking
  const processNotionImport = useCallback(() => {
    if (csvFiles.length === 0) return;

    // Step 1: Build URL index for each file - collect all Notion URLs from first column
    // Also extract notion_id for each row
    const filesWithUrlIndex = csvFiles.map(file => {
      const urlToRowIndex = new Map<string, number>(); // Notion URL -> row index
      const primaryValueIndex = new Map<string, number>(); // cleaned name -> row index
      const rowNotionIds: string[] = []; // notion_id for each data row

      if (file.data.length >= 2) {
        const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;
        dataRows.forEach((row, rowIdx) => {
          const primaryValue = row[0]?.trim();

          // Extract notion_id ONLY from first column (the name/title column)
          // This is the row's own Notion ID, not from relations
          const notionId = primaryValue ? extractNotionId(primaryValue) : null;
          rowNotionIds.push(notionId || generateLocalId(primaryValue || `row_${rowIdx}`));

          if (primaryValue) {
            // Extract Notion URLs from first column and map to row index
            const urls = extractNotionUrls(primaryValue);
            urls.forEach(url => {
              urlToRowIndex.set(url, rowIdx);
            });

            // Also store cleaned name
            const cleanedName = parseNotionRelation(primaryValue)?.[0] || primaryValue;
            primaryValueIndex.set(cleanedName.toLowerCase(), rowIdx);
          }
        });
      }
      return { ...file, urlToRowIndex, primaryValueIndex, rowNotionIds };
    });

    // Step 2: For each file, detect relation columns and find target tables BY URL MATCHING
    // Also add notion_id column and populate it with extracted IDs
    const updatedFiles = filesWithUrlIndex.map((file, fileIdx) => {
      if (file.data.length < 2) return file;

      const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;

      // First, detect which columns are relations
      const relationColumnIndices = new Set<number>();
      file.columnDefinitions.forEach((def, colIdx) => {
        const columnValues = dataRows.map(row => row[colIdx] || '');
        if (isNotionRelationColumn(columnValues)) {
          relationColumnIndices.add(colIdx);
        }
      });

      const hasHeaders = useFirstRowAsHeaders;

      // Build new headers with notion_id at the beginning
      const newHeaders = ['notion_id', ...file.headers];

      // Transform data: add notion_id column and process cells
      // For ALL columns (including relations): extract names, remove URLs
      // The actual notion_id mapping for relations happens in handleCsvCreate
      const cleanedData = file.data.map((row, rowIdx) => {
        if (rowIdx === 0 && hasHeaders) {
          // Header row - add notion_id header
          return ['notion_id', ...row];
        }

        // Data row - add notion_id value and clean cells
        const dataRowIdx = hasHeaders ? rowIdx - 1 : rowIdx;
        const notionId = file.rowNotionIds[dataRowIdx] || '';

        const cleanedRow = row.map((cell, colIdx) => {
          // For ALL columns: extract names (remove URLs)
          // Relations will be mapped to notion_ids in handleCsvCreate
          const names = parseNotionRelation(cell);
          if (names) {
            return names.join(', ');
          }
          return cell;
        });

        return [notionId, ...cleanedRow];
      });

      // Add notion_id column definition at the beginning
      const notionIdColDef: CSVColumnDefinition = {
        csvColumn: 'notion_id',
        name: 'notion_id',
        displayName: 'Notion ID',
        type: 'text',
        isNotionRelation: false
      };

      // Update column definitions - detect relations and find target tables BY URL
      // Shift column indices by 1 because we added notion_id at the beginning
      const updatedColumnDefs = file.columnDefinitions.map((def, colIdx) => {
        const columnValues = dataRows.map(row => row[colIdx] || '');
        const isRelation = isNotionRelationColumn(columnValues);

        if (!isRelation) return { ...def, isNotionRelation: false };

        // Collect all Notion URLs from this column
        const columnUrls = new Set<string>();
        columnValues.forEach(v => {
          const urls = extractNotionUrls(v);
          urls.forEach(url => columnUrls.add(url));
        });

        // Find which file has the most URL matches in its first column
        let targetFileId: string | undefined;
        let bestMatchCount = 0;

        filesWithUrlIndex.forEach((targetFile, targetIdx) => {
          if (targetIdx === fileIdx) return; // Skip self

          let matchCount = 0;
          columnUrls.forEach(url => {
            if (targetFile.urlToRowIndex.has(url)) {
              matchCount++;
            }
          });

          if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            targetFileId = targetFile.id;
          }
        });

        // If no URL match found, try matching by first word of column name vs table name
        if (!targetFileId) {
          const columnFirstWord = def.displayName.toLowerCase().split(/[\s_-]+/)[0];

          filesWithUrlIndex.forEach((targetFile, targetIdx) => {
            if (targetIdx === fileIdx) return; // Skip self

            const tableFirstWord = targetFile.tableDisplayName.toLowerCase().split(/[\s_-]+/)[0];

            // Match if first words are the same (e.g., "Ambassadors" column -> "Ambassadors" table)
            if (columnFirstWord === tableFirstWord ||
                columnFirstWord.startsWith(tableFirstWord) ||
                tableFirstWord.startsWith(columnFirstWord)) {
              targetFileId = targetFile.id;
            }
          });
        }

        // Find target file to determine best label column
        const targetFile = targetFileId ? filesWithUrlIndex.find(f => f.id === targetFileId) : undefined;
        let defaultLabelColumn = 'name';
        if (targetFile) {
          // Try to find name or title column
          const nameCol = targetFile.columnDefinitions.find(c =>
            c.name === 'name' || c.name === 'title' || c.displayName.toLowerCase() === 'name'
          );
          if (nameCol) {
            defaultLabelColumn = nameCol.name;
          }
        }

        return {
          ...def,
          isNotionRelation: true,
          relationTargetFileId: targetFileId,
          relationValueColumn: 'notion_id', // Default to notion_id
          relationLabelColumn: defaultLabelColumn, // Best guess for label
          relationStorageFormat: 'comma', // Default to comma-separated
          type: 'relation' // Set to relation type immediately
        };
      });

      return {
        ...file,
        data: cleanedData,
        headers: newHeaders,
        columnDefinitions: [notionIdColDef, ...updatedColumnDefs]
      };
    });

    // Save backup for undo
    setCsvFilesBeforeNotionImport(csvFiles);
    setCsvFiles(updatedFiles);

    // Expand all relation columns for current file
    const currentFileUpdated = updatedFiles[currentCsvFileIndex];
    if (currentFileUpdated) {
      const relationColIndices = new Set<number>();
      currentFileUpdated.columnDefinitions.forEach(col => {
        if (col.isNotionRelation) {
          relationColIndices.add(col.colIndex);
        }
      });
      setExpandedColumns(relationColIndices);
    }

    // Build log
    const logLines: NotionImportLogEntry[] = [];
    let relationColumnsCount = 0;
    let unresolvedCount = 0;

    updatedFiles.forEach(file => {
      file.columnDefinitions.forEach(col => {
        if (col.isNotionRelation) {
          relationColumnsCount++;
          const targetFile = updatedFiles.find(f => f.id === col.relationTargetFileId);
          const resolved = !!targetFile;
          if (!resolved) unresolvedCount++;
          logLines.push({
            text: `${file.tableDisplayName}.${col.displayName} → ${targetFile?.tableDisplayName || '?'}`,
            resolved,
            source: 'auto'
          });
        }
      });
    });

    if (relationColumnsCount > 0) {
      // Sort: unresolved first
      logLines.sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1));
      setNotionImportLog(logLines);
    } else {
      setNotionImportLog([{ text: t('tables.create.notionRelationsNotFound'), resolved: true }]);
    }
  }, [csvFiles, useFirstRowAsHeaders, currentCsvFileIndex, t]);

  // Undo Notion Import
  const undoNotionImport = useCallback(() => {
    if (csvFilesBeforeNotionImport) {
      setCsvFiles(csvFilesBeforeNotionImport);
      setCsvFilesBeforeNotionImport(null);
      setNotionImportLog([]);
      setExpandedColumns(new Set());
    }
  }, [csvFilesBeforeNotionImport]);

  // Update notion_id by matching names across files
  const updateNotionIdsByName = useCallback(() => {
    if (csvFiles.length === 0) return;

    const log: NotionImportLogEntry[] = [];

    // Step 1: Build global name -> notion_id mapping from ALL files
    // Scan ALL columns for Notion URLs and extract name + ID from them
    // Map: notion_key (from name) -> { notionId, fileId, originalName }
    const globalNameToNotionId = new Map<string, { notionId: string; fileId: string; originalName: string }>();

    logger.debug('=== Step 1: Building name->notionId map from Notion URLs ===');

    csvFiles.forEach(file => {
      const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;
      logger.debug(`  Scanning ${file.tableDisplayName}: ${dataRows.length} rows`);

      // Scan ALL columns for Notion URLs
      dataRows.forEach((row, rowIdx) => {
        row.forEach((cellValue, colIdx) => {
          if (!cellValue) return;

          // Look for Notion URL pattern: "Name (https://notion.so/...)"
          const notionUrlMatch = cellValue.match(/^(.+?)\s*\(https?:\/\/(?:www\.)?notion\.so\/([^)]+)\)/i);
          if (notionUrlMatch) {
            const name = notionUrlMatch[1].trim();
            const urlPath = notionUrlMatch[2];

            // Extract 32-char hex ID from URL
            const idMatch = urlPath.match(/([a-f0-9]{32})/i);
            if (idMatch && name) {
              const notionId = idMatch[1].toLowerCase();
              const notionKey = toNotionKey(name);

              // Store multiple keys for matching
              globalNameToNotionId.set(name, { notionId, fileId: file.id, originalName: name });
              globalNameToNotionId.set(name.toLowerCase(), { notionId, fileId: file.id, originalName: name });
              globalNameToNotionId.set(notionKey, { notionId, fileId: file.id, originalName: name });

              if (rowIdx < 5 && colIdx < 3) {
                logger.debug(`  Found in ${file.tableDisplayName} col[${colIdx}]: "${name}" -> ${notionKey} -> ${notionId.substring(0, 16)}...`);
              }
            }
          }
        });
      });

      // Also check existing notion_id column if it has data
      // Use selected name column from notionNameColumnMap or auto-detect
      const notionIdColDef = file.columnDefinitions.find(c =>
        c.name === 'notion_id' ||
        c.csvColumn.toLowerCase() === 'notion_id'
      );

      // Get name column - first try selected, then auto-detect
      const selectedNameCol = notionNameColumnMap[file.id];
      let nameColDef = selectedNameCol
        ? file.columnDefinitions.find(c => c.csvColumn === selectedNameCol)
        : file.columnDefinitions.find(c =>
            c.name === 'name' ||
            c.displayName.toLowerCase() === 'name' ||
            c.csvColumn.toLowerCase() === 'name'
          );

      logger.debug(`  File ${file.tableDisplayName}: notionIdCol="${notionIdColDef?.csvColumn}", nameCol="${nameColDef?.csvColumn}"`);

      if (notionIdColDef && nameColDef) {
        const notionIdColIdx = file.headers.indexOf(notionIdColDef.csvColumn);
        const nameColIdx = file.headers.indexOf(nameColDef.csvColumn);

        logger.debug(`    Indices: notionIdIdx=${notionIdColIdx}, nameIdx=${nameColIdx}`);

        if (notionIdColIdx !== -1 && nameColIdx !== -1) {
          let fromColCount = 0;
          dataRows.forEach((row, rowIdx) => {
            const notionIdValue = row[notionIdColIdx]?.trim();
            let nameValue = row[nameColIdx]?.trim();

            // Clean name if it contains Notion URL
            if (nameValue && nameValue.includes('(https://')) {
              nameValue = nameValue.replace(/\s*\(https?:\/\/[^)]+\)/g, '').trim();
            }

            if (nameValue && notionIdValue && /[a-f0-9]{32}/i.test(notionIdValue)) {
              const notionKey = toNotionKey(nameValue);
              globalNameToNotionId.set(nameValue, { notionId: notionIdValue, fileId: file.id, originalName: nameValue });
              globalNameToNotionId.set(nameValue.toLowerCase(), { notionId: notionIdValue, fileId: file.id, originalName: nameValue });
              globalNameToNotionId.set(notionKey, { notionId: notionIdValue, fileId: file.id, originalName: nameValue });
              fromColCount++;

              if (fromColCount <= 3) {
                logger.debug(`    Row ${rowIdx}: "${nameValue}" -> ${notionIdValue.substring(0, 20)}...`);
              }
            }
          });
          logger.debug(`    Extracted ${fromColCount} notion_ids from existing column`);
        }
      }
    });

    logger.debug(`UpdateNotionIds: built name->notionId map with ${Math.floor(globalNameToNotionId.size / 3)} unique entries`);

    // Debug: show mappings
    let debugCount = 0;
    globalNameToNotionId.forEach((val, key) => {
      if (debugCount < 15 && key === val.originalName) {
        logger.debug(`  Map: "${key}" -> ${val.notionId.substring(0, 20)}...`);
        debugCount++;
      }
    });

    if (globalNameToNotionId.size === 0) {
      log.push({ text: `⚠️ ${t('tables.create.noNotionUrlForId')}`, resolved: false });
      setNotionImportLog(prev => [...prev, ...log]);
      return;
    }

    // Step 2: For each file, fill empty notion_ids by matching name
    logger.debug('=== Step 2: Filling empty notion_ids by name matching ===');
    let totalUpdated = 0;

    const updatedFiles = csvFiles.map(file => {
      // Debug: log available columns
      logger.debug(`File ${file.tableDisplayName} columns:`, file.columnDefinitions.map(c =>
        `${c.displayName} (name: ${c.name}, csv: ${c.csvColumn})`
      ).join(', '));
      logger.debug(`  Headers:`, file.headers);

      // Find notion_id column - try multiple strategies
      // 1. Look in headers first (most reliable after transform)
      let notionIdColIdx = file.headers.findIndex(h =>
        h.toLowerCase() === 'notion_id' ||
        h.toLowerCase().includes('notion_id')
      );

      // 2. If not found in headers, try columnDefinitions
      if (notionIdColIdx === -1) {
        const notionIdColDef = file.columnDefinitions.find(c =>
          c.name === 'notion_id' ||
          c.displayName.toLowerCase() === 'notion_id' ||
          c.csvColumn.toLowerCase() === 'notion_id' ||
          c.csvColumn.toLowerCase().includes('notion_id')
        );
        notionIdColIdx = notionIdColDef ? file.headers.indexOf(notionIdColDef.csvColumn) : -1;
      }

      // Find name column
      const selectedNameCol = notionNameColumnMap[file.id];
      let nameColIdx = -1;

      // 1. Try selected column first
      if (selectedNameCol) {
        nameColIdx = file.headers.indexOf(selectedNameCol);
      }

      // 2. Try to find by name in headers
      if (nameColIdx === -1) {
        nameColIdx = file.headers.findIndex(h => h.toLowerCase() === 'name');
      }

      // 3. Try columnDefinitions
      if (nameColIdx === -1) {
        const nameColDef = file.columnDefinitions.find(c =>
          c.name === 'name' ||
          c.displayName.toLowerCase() === 'name' ||
          c.csvColumn.toLowerCase() === 'name'
        );
        nameColIdx = nameColDef ? file.headers.indexOf(nameColDef.csvColumn) : -1;
      }

      // 4. Fallback to first column (usually name)
      if (nameColIdx === -1) {
        nameColIdx = 0;
      }

      logger.debug(`Processing ${file.tableDisplayName}: notionIdIdx=${notionIdColIdx} (header: ${file.headers[notionIdColIdx]}), nameIdx=${nameColIdx} (header: ${file.headers[nameColIdx]})`);

      if (notionIdColIdx === -1 || nameColIdx === -1) {
        log.push({ text: `⚠️ ${t('tables.create.noNotionIdOrNameColumn').replace('{table}', file.tableDisplayName)}`, resolved: false });
        return file;
      }

      let fileUpdates = 0;

      const newData = file.data.map((row, rowIdx) => {
        if (rowIdx === 0 && useFirstRowAsHeaders) return row;

        const currentNotionId = row[notionIdColIdx]?.trim() || '';
        let nameValue = row[nameColIdx]?.trim() || '';

        // Clean name if it contains Notion URL - extract just the name part
        if (nameValue && nameValue.includes('(https://')) {
          nameValue = nameValue.replace(/\s*\(https?:\/\/[^)]+\)/g, '').trim();
        }

        // Skip if already has valid notion_id (32 hex chars)
        if (currentNotionId && /[a-f0-9]{32}/i.test(currentNotionId)) {
          return row;
        }

        // Try to find notion_id by name from ANY table
        // Try multiple keys: exact match, lowercase, notion_key format
        const notionKey = toNotionKey(nameValue);
        const mapping = globalNameToNotionId.get(nameValue) ||
                       globalNameToNotionId.get(nameValue.toLowerCase()) ||
                       globalNameToNotionId.get(notionKey);

        if (mapping) {
          // Found! Update the row
          const newRow = [...row];
          newRow[notionIdColIdx] = mapping.notionId;
          fileUpdates++;
          totalUpdated++;

          if (fileUpdates <= 10) {
            logger.debug(`  ✓ Row ${rowIdx} (${file.tableDisplayName}): "${nameValue}" -> ${mapping.notionId.substring(0, 20)}... (was: "${currentNotionId}")`);
          }

          return newRow;
        } else if (nameValue && fileUpdates <= 10) {
          // Show why no match found - first 10 unmatched only
          logger.debug(`  ✗ Row ${rowIdx} (${file.tableDisplayName}): No mapping for "${nameValue}" (notionKey: ${notionKey}, current: "${currentNotionId}")`);
        }

        return row;
      });

      if (fileUpdates > 0) {
        log.push({
          text: `✅ ${t('tables.create.updatedNotionIdByName').replace('{table}', file.tableDisplayName).replace('{count}', String(fileUpdates))}`,
          resolved: true
        });
      }

      return { ...file, data: newData };
    });

    if (totalUpdated > 0) {
      logger.debug('=== Updating csvFiles state with new data ===');
      setCsvFiles(updatedFiles);
      log.unshift({ text: `🔄 ${t('tables.create.totalUpdated').replace('{count}', String(totalUpdated))}`, resolved: true });

      // Debug: verify state will update
      logger.debug('Updated files:', updatedFiles.map(f => ({
        name: f.tableDisplayName,
        rows: f.data.length,
        sample: f.data[1]  // First data row (skip header if any)
      })));
    } else {
      log.push({ text: `✓ ${t('tables.create.allNotionIdsFilled')}`, resolved: true });
    }

    setNotionImportLog(prev => [...prev, ...log]);
  }, [csvFiles, useFirstRowAsHeaders, notionNameColumnMap]);

  // Apply Notion Transform - extracted into ./useApplyNotionTransform to keep this file under the lines guard.
  const applyNotionTransform = useApplyNotionTransform({
    csvFiles,
    setCsvFiles,
    useFirstRowAsHeaders,
    csvFilesBeforeNotionImport,
    setCsvFilesBeforeNotionImport,
    setNotionImportLog,
    notionValueDisplay,
    notionOutputFormat,
    notionCreateIdColumn,
    setNotionImportPanelVisible,
  });

  // Detect other columns that might be relations based on Notion IDs from known relations
  const detectOtherColumns = useCallback(() => {
    if (csvFiles.length === 0) return;

    // Step 1: Collect all Notion IDs from columns that already have a target file
    // Build a map: notionId -> targetFileId
    const notionIdToTargetFile = new Map<string, string>();

    csvFiles.forEach(file => {
      if (file.data.length < 2) return;
      const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;

      file.columnDefinitions.forEach((def, colIdx) => {
        // Only look at columns that are already identified as relations with a target
        if (def.isNotionRelation && def.relationTargetFileId) {
          dataRows.forEach(row => {
            const cellValue = row[colIdx] || '';
            // Extract notion IDs from original data (before cleaning) or from URLs
            const ids = extractAllNotionIds(cellValue);
            ids.forEach(id => {
              notionIdToTargetFile.set(id, def.relationTargetFileId!);
            });
          });
        }
      });
    });

    if (notionIdToTargetFile.size === 0) {
      setNotionImportLog(prev => [...prev, { text: `⚠️ ${t('tables.create.defineRelationFirst')}`, resolved: false }]);
      return;
    }

    // Step 2: Scan other columns and look for matching Notion IDs
    let foundCount = 0;
    const newLogLines: NotionImportLogEntry[] = [];

    const updatedFiles = csvFiles.map(file => {
      if (file.data.length < 2) return file;

      // Need to use original data to extract IDs - but we may have cleaned it
      // So we use csvFilesBeforeNotionImport if available
      const originalFile = csvFilesBeforeNotionImport?.find(f => f.id === file.id);
      const originalDataRows = originalFile
        ? (useFirstRowAsHeaders ? originalFile.data.slice(1) : originalFile.data)
        : (useFirstRowAsHeaders ? file.data.slice(1) : file.data);

      const updatedColumnDefs = file.columnDefinitions.map((def, colIdx) => {
        // Skip columns that are already relations (manually set or from initial Notion Import)
        // But ALLOW columns that were detected previously (source: 'detect') to be re-scanned
        if (def.isNotionRelation || def.type === 'relation') {
          return def; // Keep existing relations
        }

        // Check if this column contains any Notion IDs we know about
        let matchedTargetFileId: string | undefined;
        let matchCount = 0;

        originalDataRows.forEach(row => {
          const cellValue = row[colIdx] || '';
          const ids = extractAllNotionIds(cellValue);

          ids.forEach(id => {
            const targetFile = notionIdToTargetFile.get(id);
            if (targetFile) {
              matchedTargetFileId = targetFile;
              matchCount++;
            }
          });
        });

        // If we found at least 2 matches, mark this as a relation
        if (matchCount >= 2 && matchedTargetFileId) {
          foundCount++;
          const targetFile = csvFiles.find(f => f.id === matchedTargetFileId);
          newLogLines.push({
            text: `🔍 ${file.tableDisplayName}.${def.displayName} → ${targetFile?.tableDisplayName || '?'} (${matchCount} ${t('common.matches') || 'matches'})`,
            resolved: !!targetFile,
            source: 'detect'
          });

          return {
            ...def,
            isNotionRelation: true,
            relationTargetFileId: matchedTargetFileId,
            type: 'relation'
          };
        }

        return def;
      });

      return { ...file, columnDefinitions: updatedColumnDefs };
    });

    if (foundCount > 0) {
      setCsvFiles(updatedFiles);
      // Remove old 'detect' entries and add new ones
      setNotionImportLog(prev => [...prev.filter(l => l.source !== 'detect'), ...newLogLines]);

      // Expand newly found relation columns
      const newExpandedSet = new Set(expandedColumns);
      updatedFiles.forEach(file => {
        file.columnDefinitions.forEach(col => {
          if (col.isNotionRelation) {
            newExpandedSet.add(col.colIndex);
          }
        });
      });
      setExpandedColumns(newExpandedSet);
    } else {
      // Remove old 'detect' entries and add "not found" message
      setNotionImportLog(prev => [...prev.filter(l => l.source !== 'detect'), { text: `✓ ${t('tables.create.additionalRelationsNotFound')}`, resolved: true, source: 'detect' }]);
    }
  }, [csvFiles, csvFilesBeforeNotionImport, useFirstRowAsHeaders, expandedColumns]);

  return { processNotionImport, undoNotionImport, updateNotionIdsByName, applyNotionTransform, detectOtherColumns };
}
