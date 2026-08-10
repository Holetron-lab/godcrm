import { useCallback } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { logger } from '@/shared/utils/logger';
import { extractNotionId, getIdFromNameId } from './notion-utils';
import type { CSVFileData, NotionImportLogEntry } from './types';

interface UseApplyNotionTransformParams {
  csvFiles: CSVFileData[];
  setCsvFiles: React.Dispatch<React.SetStateAction<CSVFileData[]>>;
  useFirstRowAsHeaders: boolean;
  csvFilesBeforeNotionImport: CSVFileData[] | null;
  setCsvFilesBeforeNotionImport: React.Dispatch<React.SetStateAction<CSVFileData[] | null>>;
  setNotionImportLog: React.Dispatch<React.SetStateAction<NotionImportLogEntry[]>>;
  notionValueDisplay: 'names' | 'notion_id';
  notionOutputFormat: 'comma' | 'json' | 'semicolon';
  notionCreateIdColumn: boolean;
  setNotionImportPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Apply Notion Transform - transform ALL data based on settings.
 * Extracted from useNotionImport to keep the main hook under the file-lines guard.
 */
export function useApplyNotionTransform(params: UseApplyNotionTransformParams) {
  const {
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
  } = params;

  const { t } = useLanguage();

  const applyNotionTransform = useCallback(() => {
    if (csvFiles.length === 0) return;

    logger.debug('=== applyNotionTransform called ===');
    logger.debug('notionValueDisplay:', notionValueDisplay);
    logger.debug('notionOutputFormat:', notionOutputFormat);

    // Save original state for undo
    if (!csvFilesBeforeNotionImport) {
      setCsvFilesBeforeNotionImport(JSON.parse(JSON.stringify(csvFiles)));
    }

    const log: NotionImportLogEntry[] = [];
    let totalTransformed = 0;

    const updatedFiles = csvFiles.map(file => {
      logger.debug(`[applyNotionTransform] Processing file: ${file.tableDisplayName}`);

      try {
        // Track if first column should be notion_id
        let hasNotionIdColumn = false;
        const firstColName = file.headers[0]?.toLowerCase() || '';

        logger.debug(`[applyNotionTransform] ${file.tableDisplayName}: Starting data transformation...`);

        const newData = file.data.map((row, rowIdx) => {
          if (rowIdx === 0 && useFirstRowAsHeaders) return row; // Skip header

          return row.map((cell, colIdx) => {
            if (!cell) return cell;

            // Check if cell contains Notion URL pattern: "Name (https://notion.so/...)"
            const notionUrlMatch = cell.match(/\(https?:\/\/(?:www\.)?notion\.so\/[^)]+\)/g);
            if (!notionUrlMatch) return cell;

            // This cell has Notion URLs - extract data based on settings
            // Split by multiple values (comma-separated with URLs)
            // Pattern: "Name1 (url1), Name2 (url2)" or just "Name (url)"

            const items: { name: string; notionId: string | null }[] = [];

            // Match pattern: "Name (https://notion.so/...)"
            const itemPattern = /([^,()]+)\s*\(https?:\/\/(?:www\.)?notion\.so\/[^)]+\)/g;
            let match;
            while ((match = itemPattern.exec(cell)) !== null) {
              const name = match[1].trim();
              const fullMatch = match[0];
              const notionId = extractNotionId(fullMatch);
              items.push({ name, notionId });
            }

            // If no items found with pattern, try to extract from the whole cell
            if (items.length === 0) {
              const notionId = extractNotionId(cell);
              const nameMatch = cell.match(/^([^(]+)/);
              const name = nameMatch ? nameMatch[1].trim() : cell;
              if (notionId || name) {
                items.push({ name, notionId });
              }
            }

            if (items.length === 0) return cell;

            // Build result based on settings
            let resultParts: string[];

            if (notionValueDisplay === 'notion_id') {
              resultParts = items.map(item => item.notionId || `⚠️${item.name}`);
            } else {
              // names
              resultParts = items.map(item => item.name);
            }

            // Format output
            if (notionOutputFormat === 'json') {
              return JSON.stringify(resultParts);
            } else if (notionOutputFormat === 'semicolon') {
              return resultParts.join('; ');
            } else {
              return resultParts.join(', ');
            }
          });
        });

        logger.debug(`[applyNotionTransform] ${file.tableDisplayName}: Data transformed, updating definitions...`);

        logger.debug(`[applyNotionTransform] ${file.tableDisplayName}: Data transformed, creating notion_id column...`);

        // Skip complex columnDefinitions update for now - just create notion_id column
        // The columnDefinitions update will happen in next step
        let finalData = newData;
        let finalColDefs = file.columnDefinitions;

      // Create notion_id column if:
      // 1. Checkbox is enabled and we're saving names, OR
      // 2. We're saving notion_id (always create the column in this case)
      const shouldCreateNotionIdCol = notionCreateIdColumn || notionValueDisplay === 'notion_id';

      logger.debug(`File ${file.tableDisplayName}: shouldCreateNotionIdCol=${shouldCreateNotionIdCol}, notionCreateIdColumn=${notionCreateIdColumn}`);

      if (shouldCreateNotionIdCol) {
        // Check if first column is already notion_id
        const firstColName = file.headers[0]?.toLowerCase() || '';
        const hasNotionIdCol = firstColName.includes('notion') && firstColName.includes('id');

        logger.debug(`  firstColName="${firstColName}", hasNotionIdCol=${hasNotionIdCol}`);

        if (!hasNotionIdCol) {
          // Find the Name column or first column with Notion URLs
          // Priority: 1) Column named "Name", 2) First column with Notion URLs, 3) First column
          let sourceColIdx = 0;

          // Try to find Name column
          const nameColIdx = file.headers.findIndex(h => h.toLowerCase() === 'name');
          if (nameColIdx !== -1) {
            sourceColIdx = nameColIdx;
          } else {
            // Find first column with Notion URLs - use ORIGINAL data, not transformed
            const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;
            for (let colIdx = 0; colIdx < file.headers.length; colIdx++) {
              const hasUrls = dataRows.some(row => {
                const cell = row[colIdx] || '';
                return /\(https?:\/\/(?:www\.)?notion\.so\/[^)]+\)/.test(cell) ||
                       /https?:\/\/(?:www\.)?notion\.so\/[^\s]+[a-f0-9]{32}/i.test(cell);
              });
              if (hasUrls) {
                sourceColIdx = colIdx;
                break;
              }
            }
          }

          logger.debug(`  Creating notion_id column from source column ${sourceColIdx} (${file.headers[sourceColIdx]})`);

          // Extract notion_ids from ORIGINAL source column (before transformation)
          finalData = newData.map((row, rowIdx) => {
            if (rowIdx === 0 && useFirstRowAsHeaders) {
              return ['notion_id', ...row];
            }
            // Extract notion_id from ORIGINAL source column cell (before transformation)
            const originalCell = file.data[rowIdx]?.[sourceColIdx] || '';
            const notionId = extractNotionId(originalCell) || '';

            if (rowIdx <= 5) {
              logger.debug(`    Row ${rowIdx}: source="${originalCell.substring(0, 60)}..." -> notionId="${notionId}"`);
            }

            return [notionId, ...row];
          });

          // Add notion_id column definition
          finalColDefs = [
            {
              csvColumn: 'notion_id',
              name: 'notion_id',
              displayName: 'Notion ID',
              type: 'text',
              emoji: '🔑'
            },
            ...file.columnDefinitions
          ];

          // Update headers
          const newHeaders = ['notion_id', ...file.headers];
          return {
            ...file,
            data: finalData,
            headers: newHeaders,
            columnDefinitions: finalColDefs
          };
        }
      }

      return { ...file, data: finalData, columnDefinitions: finalColDefs };
      } catch (error) {
        logger.error(`[applyNotionTransform] Error processing file ${file.tableDisplayName}:`, error);
        return file; // Return unchanged file on error
      }
    });

    setCsvFiles(updatedFiles);

    // Count transformations
    totalTransformed = 0;
    let notionIdColsCreated = 0;
    updatedFiles.forEach((f, i) => {
      f.columnDefinitions.forEach((def, idx) => {
        if (def.isNotionRelation) totalTransformed++;
      });
      // Check if notion_id column was added
      if (f.columnDefinitions[0]?.name === 'notion_id' && csvFiles[i]?.columnDefinitions[0]?.name !== 'notion_id') {
        notionIdColsCreated++;
      }
    });

    let logText = `✅ ${t('tables.create.transformed').replace('{from}', notionValueDisplay === 'notion_id' ? 'Notion ID' : t('tables.create.names')).replace('{to}', notionOutputFormat)}`;
    if (notionIdColsCreated > 0) {
      logText += ` ${t('tables.create.notionIdColsCreated').replace('{count}', String(notionIdColsCreated))}`;
    }

    log.push({
      text: logText,
      resolved: true
    });

    // Auto-detect relations after transformation
    // Build map of notion_id -> file for all files that have notion_id column
    const notionIdToFile = new Map<string, string>();
    // Also build map of name -> file for name-based matching
    const nameToFile = new Map<string, string>();

    updatedFiles.forEach(file => {
      const notionIdColIdx = file.columnDefinitions.findIndex(c => c.name === 'notion_id');
      const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;

      // Build notion_id -> file mapping
      if (notionIdColIdx !== -1) {
        dataRows.forEach(row => {
          const notionIdValue = row[notionIdColIdx];
          // Support both pure ID and name-id format
          const pureId = getIdFromNameId(notionIdValue);
          if (pureId && /^[a-f0-9]{32}$/i.test(pureId)) {
            notionIdToFile.set(pureId.toLowerCase(), file.id);
            // Also map full name-id if different
            if (notionIdValue !== pureId) {
              notionIdToFile.set(notionIdValue.toLowerCase(), file.id);
            }
          }
        });
      }

      // Build name -> file mapping from first data column (usually 'name')
      // Use the column AFTER notion_id if it exists, otherwise first column
      const nameColIdx = notionIdColIdx !== -1 ? 1 : 0;
      dataRows.forEach(row => {
        const name = row[nameColIdx]?.trim();
        if (name && name.length > 0 && name.length < 200) {
          nameToFile.set(name.toLowerCase(), file.id);
          nameToFile.set(name, file.id); // Also store original case
        }
      });
    });

    logger.debug(`Auto-detect: built notionIdToFile with ${notionIdToFile.size} entries, nameToFile with ${nameToFile.size / 2} entries`);

    // Now scan all columns in all files to find relations
    let foundRelations = 0;
    const filesWithRelations = updatedFiles.map(file => {
      const updatedColDefs = file.columnDefinitions.map((def, colIdx) => {
        // Skip notion_id column itself and already identified relations
        if (def.name === 'notion_id' || def.isNotionRelation || def.type === 'relation') {
          return def;
        }

        // Check if this column contains notion IDs or names that match other tables
        const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;
        const matchedFiles = new Map<string, number>(); // fileId -> match count

        dataRows.forEach(row => {
          const cellValue = row[colIdx] || '';

          // Strategy 1: Look for 32-char hex IDs (notion_id mode) or name-id format
          // Match both pure IDs and name-id format like name-32hexchars
          const nameIdMatches = cellValue.match(/[a-zA-Z0-9_]+-[a-f0-9]{32}/gi) || [];
          const pureIdMatches = cellValue.match(/(?<!-)\b[a-f0-9]{32}\b(?!-)/gi) || [];
          const allMatches = [...nameIdMatches.map(m => getIdFromNameId(m)), ...pureIdMatches];

          allMatches.forEach(id => {
            const targetFileId = notionIdToFile.get(id.toLowerCase());
            if (targetFileId && targetFileId !== file.id) {
              matchedFiles.set(targetFileId, (matchedFiles.get(targetFileId) || 0) + 1);
            }
          });

          // Strategy 2: Look for names (names mode) - split by comma/semicolon
          if (allMatches.length === 0 && cellValue) {
            const names = cellValue.split(/[,;]/).map(n => n.trim()).filter(n => n.length > 0);
            names.forEach(name => {
              const targetFileId = nameToFile.get(name) || nameToFile.get(name.toLowerCase());
              if (targetFileId && targetFileId !== file.id) {
                matchedFiles.set(targetFileId, (matchedFiles.get(targetFileId) || 0) + 1);
              }
            });
          }
        });

        // Find the best match (most occurrences)
        let bestMatch: { fileId: string; count: number } | null = null;
        matchedFiles.forEach((count, fileId) => {
          if (!bestMatch || count > bestMatch.count) {
            bestMatch = { fileId, count };
          }
        });

        // If we have at least 2 matches, mark as relation
        if (bestMatch !== null && bestMatch.count >= 2) {
          foundRelations++;
          const matchFileId = bestMatch.fileId;
          const matchCount = bestMatch.count;
          const targetFile = updatedFiles.find(f => f.id === matchFileId);
          log.push({
            text: `🔗 ${t('tables.create.relationFound').replace('{source}', file.tableDisplayName).replace('{column}', def.displayName).replace('{target}', targetFile?.tableDisplayName || '?').replace('{count}', String(matchCount))}`,
            resolved: true
          });

          return {
            ...def,
            isNotionRelation: true,
            relationTargetFileId: matchFileId,
            type: 'relation' as const
          };
        }

        // Strategy 3: Match column name to table name
        // e.g., column "ambassadors" -> table "Ambassadors 2640daec7d5a80318cd7db9fbba2ca98_all"
        // or column "Parcels" -> table "Parcels 26b0daec..."
        // Skip columns that are clearly not relations
        const skipColNames = ['name', 'notion_id', 'notion id', 'id', 'created', 'modified', 'date', 'email', 'phone', 'address', 'notes', 'description'];
        if (skipColNames.some(skip => def.displayName.toLowerCase().includes(skip) || def.csvColumn.toLowerCase().includes(skip))) {
          logger.debug(`Strategy 3: SKIP column "${def.displayName}" (reserved name)`);
          return def;
        }

        const colNameLower = def.displayName.toLowerCase().trim();
        const colCsvNameLower = def.csvColumn.toLowerCase().trim();
        // Keep only Unicode letters and numbers for comparison (supports all languages)
        const colNameClean = colNameLower.replace(/[^\p{L}\p{N}]/gu, '');
        const colCsvClean = colCsvNameLower.replace(/[^\p{L}\p{N}]/gu, '');

        logger.debug(`Strategy 3: checking column "${def.displayName}" / "${def.csvColumn}" (clean: "${colNameClean}" / "${colCsvClean}")`);

        for (const targetFile of updatedFiles) {
          if (targetFile.id === file.id) {
            continue;
          }

          // Extract first word of table name (before any ID, space, underscore or dash)
          const tableNameLower = targetFile.tableDisplayName.toLowerCase();
          // Get first meaningful word - split by space, underscore, dash, or hex ID pattern
          const tableNameParts = tableNameLower.split(/[\s_-]+/);
          const tableNameFirstWord = tableNameParts[0]?.replace(/[^\p{L}\p{N}]/gu, '') || '';
          // Also try full table name without hex ID
          const tableNameWithoutId = tableNameLower.replace(/[a-f0-9]{32}/gi, '').replace(/[_\s-]+/g, '').trim();

          // Multiple match strategies
          const isMatch = (colNameClean.length >= 3 && tableNameFirstWord.length >= 3 &&
              (colNameClean === tableNameFirstWord ||
               tableNameFirstWord.startsWith(colNameClean) ||
               colNameClean.startsWith(tableNameFirstWord))) ||
              // Also try CSV column name
              (colCsvClean.length >= 3 && tableNameFirstWord.length >= 3 &&
              (colCsvClean === tableNameFirstWord ||
               tableNameFirstWord.startsWith(colCsvClean) ||
               colCsvClean.startsWith(tableNameFirstWord))) ||
              // Try full table name match
              (colNameClean.length >= 4 && tableNameWithoutId.includes(colNameClean)) ||
              (colCsvClean.length >= 4 && tableNameWithoutId.includes(colCsvClean));

          logger.debug(`  - comparing col="${colNameClean}/${colCsvClean}" with table="${tableNameFirstWord}" (full: ${tableNameWithoutId}) => ${isMatch ? 'MATCH' : 'no'}`);

          // Check if column name matches table name start (at least 3 chars)
          if (isMatch) {
            foundRelations++;
            log.push({
              text: `🏷️ ${t('tables.create.relationByName').replace('{source}', file.tableDisplayName).replace('{column}', def.displayName).replace('{target}', targetFile.tableDisplayName)}`,
              resolved: true
            });

            logger.debug(`  ✓ MATCH! ${def.displayName} -> ${targetFile.tableDisplayName}`);

            return {
              ...def,
              isNotionRelation: true,
              relationTargetFileId: targetFile.id,
              type: 'relation' as const
            };
          }
        }

        return def;
      });

      return { ...file, columnDefinitions: updatedColDefs };
    });

    if (foundRelations > 0) {
      setCsvFiles(filesWithRelations);
      log.push({ text: `✅ ${t('tables.create.foundRelations').replace('{count}', String(foundRelations))}`, resolved: true });
    }

    setNotionImportLog(prev => [...prev, ...log]);
    setNotionImportPanelVisible(true);
  }, [csvFiles, csvFilesBeforeNotionImport, useFirstRowAsHeaders, notionValueDisplay, notionOutputFormat, notionCreateIdColumn]);

  return applyNotionTransform;
}
