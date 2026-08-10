import { useCallback, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { toSlug } from '@/shared/utils/i18n-utils';
import { parseCSV, guessColumnType } from './csv-utils';
import type { CSVFileData, CSVColumnDefinition, CSVColumnFieldValue } from './types';

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
}

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
  } = params;

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

  // CSV file upload handler - supports multiple files
  const handleCsvFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const newCsvFiles: CSVFileData[] = [];
    let processedCount = 0;

    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const rows = parseCSV(text);

          if (rows.length >= 2) {
            const headers = rows[0];
            const fileName = file.name.replace(/\.csv$/i, '');

            // Generate unique column names
            const usedNames = new Set<string>();
            const definitions: CSVColumnDefinition[] = headers.map((csvCol, colIdx) => {
              const guessedType = guessColumnType(csvCol, rows.slice(1).map(r => r[headers.indexOf(csvCol)]));

              // Generate base name from column header using multi-language transliteration
              let baseName = toSlug(csvCol) || csvCol.toLowerCase().replace(/[^a-z0-9_]/gi, '_');

              // If empty or only underscores, use type as base
              if (!baseName || baseName === '_' || /^_+$/.test(baseName)) {
                baseName = guessedType;
              }

              // Make unique by adding suffix if needed
              let finalName = baseName;
              let suffix = 1;
              while (usedNames.has(finalName)) {
                finalName = `${baseName}_${String(suffix).padStart(2, '0')}`;
                suffix++;
              }
              usedNames.add(finalName);

              return {
                colIndex: colIdx,
                csvColumn: csvCol,
                name: finalName,
                displayName: csvCol || `Column ${colIdx + 1}`,
                type: guessedType,
                isNotionRelation: false,
                relationTargetFileId: undefined
              };
            });

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
              columnDefinitions: definitions
            });
          }
        } catch (err) {
          logger.error('CSV parse error:', err);
        }

        processedCount++;
        if (processedCount === files.length && newCsvFiles.length > 0) {
          setCsvFiles(prev => [...prev, ...newCsvFiles]);
          setCurrentCsvFileIndex(0);
          // Set basic info from first file
          const firstFile = newCsvFiles[0];
          setBasic(prev => ({
            ...prev,
            displayName: firstFile.tableDisplayName,
            name: firstFile.tableName,
            icon: firstFile.icon
          }));
          setCsvStep('configure');
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const handleCsvDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleCsvDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files).filter(
      file => file.type === 'text/csv' || file.name.endsWith('.csv')
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
    updateCsvColumn,
    updateCurrentCsvFile,
    handleCsvMenuToggle,
    updateCsvTabsScroll,
    scrollCsvTabs,
    toggleColumnExpanded,
  };
}
