import { useCallback, useEffect, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { toSlug } from '@/shared/utils/i18n-utils';
import { parseCSV, guessColumnType } from './csv-utils';
import { excelImportApi } from '../../api/excelImportApi';
import {
  applyExcelPreview, buildColumnDefinitions, createExcelFileEntry,
  isCsvFileName, isExcelFileName, isSupportedImportFile,
} from './excel-utils';
import type { CSVFileData, CSVColumnDefinition, CSVColumnFieldValue, ExcelFileState } from './types';

interface UseCsvHandlersParams {
  csvFiles: CSVFileData[];
  setCsvFiles: React.Dispatch<React.SetStateAction<CSVFileData[]>>;
  currentCsvFileIndex: number;
  setCurrentCsvFileIndex: React.Dispatch<React.SetStateAction<number>>;
  setCsvStep: React.Dispatch<React.SetStateAction<'upload' | 'configure' | 'creating'>>;
  setBasic: React.Dispatch<React.SetStateAction<{displayName: string; name: string; description: string; icon: string; color: string}>>;
  csvTabsRef: React.RefObject<HTMLDivElement>;
  setCanScrollCsvTabsLeft: React.Dispatch<React.SetStateAction<boolean>>;
  setCanScrollCsvTabsRight: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTabLeftHidden: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTabRightHidden: React.Dispatch<React.SetStateAction<boolean>>;
  expandedColumns: Set<number>;
  setExpandedColumns: React.Dispatch<React.SetStateAction<Set<number>>>;
  // Excel preview is served per project (write access is checked there).
  targetProjectId?: number | null;
  noProjectMessage?: string;
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

export function useCsvHandlers(params: UseCsvHandlersParams) {
  const {
    csvFiles,
    setCsvFiles,
    currentCsvFileIndex,
    setCurrentCsvFileIndex,
    setCsvStep,
    setBasic,
    csvTabsRef,
    setCanScrollCsvTabsLeft,
    setCanScrollCsvTabsRight,
    setSelectedTabLeftHidden,
    setSelectedTabRightHidden,
    expandedColumns,
    setExpandedColumns,
    targetProjectId = null,
    noProjectMessage = 'Select a project before reading an Excel file.',
  } = params;

  // One in-flight preview per Excel entry; a sheet change cancels the previous one.
  const previewControllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    previewControllers.current.forEach(controller => controller.abort());
    previewControllers.current.clear();
  }, []);

  const updateCsvTabsScroll = useCallback(() => {
    const container = csvTabsRef.current;
    if (!container) return;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    setCanScrollCsvTabsLeft(container.scrollLeft > 0);
    setCanScrollCsvTabsRight(container.scrollLeft < maxScrollLeft - 1);
    const selectedTab = container.querySelector<HTMLElement>(`[data-csv-tab="${currentCsvFileIndex}"]`);
    if (selectedTab) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = selectedTab.getBoundingClientRect();
      setSelectedTabLeftHidden(tabRect.left < containerRect.left + 4);
      setSelectedTabRightHidden(tabRect.right > containerRect.right - 4);
    } else {
      setSelectedTabLeftHidden(false);
      setSelectedTabRightHidden(false);
    }
  }, [currentCsvFileIndex]);

  const scrollCsvTabs = useCallback((direction: 'left' | 'right') => {
    const container = csvTabsRef.current;
    if (!container) return;
    const amount = Math.max(160, container.clientWidth * 0.6);
    container.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth'
    });
  }, []);

  const patchExcelEntry = useCallback((fileId: string, patch: (entry: CSVFileData) => CSVFileData) => {
    setCsvFiles(prev => prev.map(entry => (entry.id === fileId ? patch(entry) : entry)));
  }, []);

  // Fetches the sheet list (sheetIndex undefined) or one sheet's data.
  const loadExcelPreview = useCallback(async (entry: CSVFileData, sheetIndex?: number) => {
    const excel = entry.excel as ExcelFileState;
    previewControllers.current.get(entry.id)?.abort();
    const controller = new AbortController();
    previewControllers.current.set(entry.id, controller);
    if (!targetProjectId) {
      patchExcelEntry(entry.id, current => ({
        ...current,
        excel: { ...(current.excel as ExcelFileState), loading: false, error: noProjectMessage },
      }));
      return;
    }
    patchExcelEntry(entry.id, current => ({
      ...current,
      excel: { ...(current.excel as ExcelFileState), loading: true, error: null },
    }));
    try {
      let preview = await excelImportApi.preview(targetProjectId, excel.file, sheetIndex, controller.signal);
      // A single-sheet workbook has nothing to choose; load it right away.
      if (!preview.sheet && preview.sheets.length === 1) {
        preview = await excelImportApi.preview(targetProjectId, excel.file, preview.sheets[0].index, controller.signal);
      }
      if (controller.signal.aborted) return;
      patchExcelEntry(entry.id, current => applyExcelPreview(current, preview, toSlug));
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return;
      logger.error('Excel preview error:', err);
      const message = err instanceof Error ? err.message : 'Excel preview failed';
      patchExcelEntry(entry.id, current => ({
        ...current,
        excel: { ...(current.excel as ExcelFileState), loading: false, error: message },
      }));
    } finally {
      if (previewControllers.current.get(entry.id) === controller) previewControllers.current.delete(entry.id);
    }
  }, [targetProjectId, noProjectMessage, patchExcelEntry]);

  const commitNewFiles = useCallback((newFiles: CSVFileData[]) => {
    if (newFiles.length === 0) return;
    setCsvFiles(prev => [...prev, ...newFiles]);
    setCurrentCsvFileIndex(0);
    // Set basic info from first file
    const firstFile = newFiles[0];
    setBasic(prev => ({
      ...prev,
      displayName: firstFile.tableDisplayName,
      name: firstFile.tableName,
      icon: firstFile.icon
    }));
    setCsvStep('configure');
    newFiles.filter(file => file.source === 'excel').forEach(file => { void loadExcelPreview(file); });
  }, [loadExcelPreview]);

  // File upload handler - supports multiple CSV files plus Excel workbooks
  const handleCsvFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const excelFiles = files.filter(file => isExcelFileName(file.name));
    const csvFileList = files.filter(file => !isExcelFileName(file.name));
    const excelEntries = excelFiles.map((file, index) => createExcelFileEntry(file, index));

    if (csvFileList.length === 0) {
      commitNewFiles(excelEntries);
      return;
    }

    const newCsvFiles: CSVFileData[] = [];
    let processedCount = 0;

    csvFileList.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const rows = parseCSV(text);

          if (rows.length >= 2) {
            const headers = rows[0];
            const fileName = file.name.replace(/\.csv$/i, '');
            const dataRows = rows.slice(1);
            const definitions: CSVColumnDefinition[] = buildColumnDefinitions(
              headers,
              (csvCol, colIdx) => guessColumnType(csvCol, dataRows.map(r => r[colIdx])),
              toSlug,
            );

            newCsvFiles.push({
              id: `csv-${Date.now()}-${index}`,
              fileName: file.name,
              tableName: fileName.toLowerCase().replace(/[^a-z0-9_]/gi, '_'),
              tableDisplayName: fileName,
              tableDescription: '',
              icon: '\u{1F4CA}',
              color: null,
              showInMenu: false,
              menuWidgetTitle: '',
              menuWidgetIcon: '',
              menuWidgetDescription: '',
              data: rows,
              headers,
              columnDefinitions: definitions,
              source: 'csv',
            });
          }
        } catch (err) {
          logger.error('CSV parse error:', err);
        }

        processedCount++;
        if (processedCount === csvFileList.length) {
          commitNewFiles([...newCsvFiles, ...excelEntries]);
        }
      };
      reader.readAsText(file);
    });
  }, [commitNewFiles]);

  const handleCsvDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleCsvDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files).filter(
      file => isSupportedImportFile(file) || isCsvFileName(file.name)
    );

    if (files.length > 0) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      const dataTransfer = new DataTransfer();
      files.forEach(f => dataTransfer.items.add(f));
      input.files = dataTransfer.files;
      handleCsvFileUpload({ target: input } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [handleCsvFileUpload]);

  // Sheet selection re-sends the original File; stale previews are cancelled.
  const selectExcelSheet = useCallback((fileId: string, sheetIndex: number) => {
    const entry = csvFiles.find(file => file.id === fileId);
    if (!entry?.excel) return;
    void loadExcelPreview(entry, sheetIndex);
  }, [csvFiles, loadExcelPreview]);

  const retryExcelPreview = useCallback((fileId: string) => {
    const entry = csvFiles.find(file => file.id === fileId);
    if (!entry?.excel) return;
    void loadExcelPreview(entry, entry.excel.sheetIndex ?? undefined);
  }, [csvFiles, loadExcelPreview]);

  const updateCsvColumn = useCallback((colIndex: number, field: keyof CSVColumnDefinition, value: CSVColumnFieldValue) => {
    setCsvFiles(prev => {
      let updatedFiles = prev.map((file, idx) => {
        if (idx !== currentCsvFileIndex) return file;
        return {
          ...file,
          columnDefinitions: file.columnDefinitions.map(def =>
            def.colIndex === colIndex ? { ...def, [field]: value } : def
          )
        };
      });

      // Sync relations with reverse relations
      const currentFile = updatedFiles[currentCsvFileIndex];
      const updatedColumn = currentFile?.columnDefinitions.find(d => d.colIndex === colIndex);

      // When relationTargetFileId is set, add reverse relation to target's notion_id column
      if (field === 'relationTargetFileId' && value && updatedColumn) {
        const targetFileId = value as string;
        const targetFileIdx = updatedFiles.findIndex(f => f.id === targetFileId);

        if (targetFileIdx !== -1) {
          updatedFiles = updatedFiles.map((file, idx) => {
            if (idx !== targetFileIdx) return file;

            // Find notion_id column in target file
            return {
              ...file,
              columnDefinitions: file.columnDefinitions.map(def => {
                if (def.name !== 'notion_id') return def;

                // Add reverse relation if not already exists
                const existingRR = def.reverseRelations || [];
                const alreadyExists = existingRR.some(
                  rr => rr.targetFileId === currentFile.id && rr.targetColumn === updatedColumn.name
                );

                if (!alreadyExists) {
                  return {
                    ...def,
                    reverseRelations: [
                      ...existingRR,
                      { targetFileId: currentFile.id, targetColumn: updatedColumn.name }
                    ]
                  };
                }
                return def;
              })
            };
          });
        }
      }

      // When reverse relation is added, ensure target column has relation back
      if (field === 'reverseRelations' && Array.isArray(value)) {
        const reverseRelations = value as Array<{ targetFileId: string; targetColumn: string }>;

        reverseRelations.forEach(rr => {
          if (!rr.targetFileId || !rr.targetColumn) return;

          const targetFileIdx = updatedFiles.findIndex(f => f.id === rr.targetFileId);
          if (targetFileIdx === -1) return;

          updatedFiles = updatedFiles.map((file, idx) => {
            if (idx !== targetFileIdx) return file;

            return {
              ...file,
              columnDefinitions: file.columnDefinitions.map(def => {
                if (def.name !== rr.targetColumn) return def;

                // Set relation target to current file if not already set
                if (!def.relationTargetFileId) {
                  return {
                    ...def,
                    relationTargetFileId: currentFile.id,
                    isNotionRelation: true,
                    type: 'relation'
                  };
                }
                return def;
              })
            };
          });
        });
      }

      return updatedFiles;
    });
  }, [currentCsvFileIndex]);

  // Update current CSV file info
  const updateCurrentCsvFile = useCallback((updates: Partial<CSVFileData>) => {
    setCsvFiles(prev => prev.map((file, idx) => {
      if (idx !== currentCsvFileIndex) return file;
      return { ...file, ...updates };
    }));
  }, [currentCsvFileIndex]);

  const handleCsvMenuToggle = useCallback((checked: boolean) => {
    setCsvFiles(prev => prev.map((file, idx) => {
      if (idx !== currentCsvFileIndex) return file;
      if (checked) {
        return {
          ...file,
          showInMenu: true,
          menuWidgetTitle: file.tableDisplayName || file.tableName,
          menuWidgetIcon: file.icon || '\u{1F4CA}',
          menuWidgetDescription: file.tableDescription || ''
        };
      }
      return {
        ...file,
        showInMenu: false,
        menuWidgetTitle: '',
        menuWidgetIcon: '',
        menuWidgetDescription: ''
      };
    }));
  }, [currentCsvFileIndex]);

  const toggleColumnExpanded = useCallback((colIndex: number) => {
    setExpandedColumns(prev => {
      const next = new Set(prev);
      if (next.has(colIndex)) {
        next.delete(colIndex);
      } else {
        next.add(colIndex);
      }
      return next;
    });
  }, []);

  return {
    handleCsvFileUpload,
    handleCsvDragOver,
    handleCsvDrop,
    selectExcelSheet,
    retryExcelPreview,
    updateCsvColumn,
    updateCurrentCsvFile,
    handleCsvMenuToggle,
    updateCsvTabsScroll,
    scrollCsvTabs,
    toggleColumnExpanded,
  };
}
