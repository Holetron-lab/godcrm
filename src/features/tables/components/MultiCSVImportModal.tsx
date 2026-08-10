import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal, Button, Input, Select } from '@/shared/components/ui';
import { Upload, Table, Link2, ChevronRight, ChevronLeft, Check, Loader2, Sparkles } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { tablesApi } from '../api/tablesApi';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getColumnTypeOptionsForCSV } from '@/shared/types';
import { apiClient } from '@/shared/utils/apiClient';
import { EmojiPicker } from './UniversalTable/EmojiPicker';
import { TableMenuWidgetToggle } from './TableMenuWidgetToggle';
import {
  type CSVFile,
  type CSVColumnDef,
  parseNotionRelation,
  parseCSV,
  detectNotionRelation,
  guessColumnType,
  convertValue,
} from './MultiCSVImport/csvHelpers';

interface MultiCSVImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
}

export const MultiCSVImportModal = ({ open, onOpenChange, projectId }: MultiCSVImportModalProps) => {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const CSV_COLUMN_TYPES = useMemo(() => getColumnTypeOptionsForCSV(language as 'ru' | 'en'), [language]);
  
  // State
  const [step, setStep] = useState<'upload' | 'configure' | 'relations' | 'creating' | 'done'>('upload');
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [createdTables, setCreatedTables] = useState<Array<{ id: number; name: string }>>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);
  
  const currentFile = csvFiles[currentFileIndex];

  const updateTabsScroll = useCallback(() => {
    const container = tabsRef.current;
    if (!container) return;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    setCanScrollTabsLeft(container.scrollLeft > 0);
    setCanScrollTabsRight(container.scrollLeft < maxScrollLeft - 1);
  }, []);

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const container = tabsRef.current;
    if (!container) return;
    const amount = Math.max(160, container.clientWidth * 0.6);
    container.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth'
    });
  }, []);

  useEffect(() => {
    updateTabsScroll();
  }, [updateTabsScroll, csvFiles.length]);
  
  // Reset state
  const resetState = useCallback(() => {
    setStep('upload');
    setCsvFiles([]);
    setCurrentFileIndex(0);
    setCreating(false);
    setProgress({ current: 0, total: 0, status: '' });
    setCreatedTables([]);
  }, []);

  // Handle multiple file upload
  const handleFilesUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const newCsvFiles: CSVFile[] = [];
    let processed = 0;

    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const rows = parseCSV(text);
          
          if (rows.length < 2) return;

          const headers = rows[0];
          const dataRows = rows.slice(1);
          
          const columns: CSVColumnDef[] = headers.map(csvCol => {
            const colValues = dataRows.map(r => r[headers.indexOf(csvCol)]);
            const guessedType = guessColumnType(csvCol, colValues);
            const hasNotion = detectNotionRelation(colValues);
            
            return {
              csvColumn: csvCol,
              name: csvCol.toLowerCase().replace(/[^a-z0-9_]/gi, '_'),
              displayName: csvCol,
              type: hasNotion ? 'relation' : guessedType,
              isRelation: hasNotion,
              relationConfig: hasNotion ? {
                targetFileId: '',
                labelColumn: 'name',
                convertNotion: true
              } : undefined
            };
          });

          const fileName = file.name.replace(/\.csv$/i, '');
          newCsvFiles.push({
            id: `file-${index}-${Date.now()}`,
            file,
            name: file.name,
            tableName: fileName.toLowerCase().replace(/[^a-z0-9_]/gi, '_'),
            tableDisplayName: fileName,
            icon: '📊',
            showInMenu: false,
            headers,
            data: rows,
            columns,
            processed: false
          });
        } catch (err) {
          logger.error('CSV parse error:', err);
        }
        
        processed++;
        if (processed === files.length) {
          setCsvFiles(prev => [...prev, ...newCsvFiles].sort((a, b) => a.name.localeCompare(b.name)));
          setStep('configure');
        }
      };
      reader.readAsText(file);
    });
  }, []);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files).filter(
      f => f.type === 'text/csv' || f.name.endsWith('.csv')
    );
    
    if (files.length > 0) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      const dataTransfer = new DataTransfer();
      files.forEach(f => dataTransfer.items.add(f));
      input.files = dataTransfer.files;
      handleFilesUpload({ target: input } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [handleFilesUpload]);

  // Update column definition
  const updateColumn = useCallback((fileId: string, csvColumn: string, updates: Partial<CSVColumnDef>) => {
    setCsvFiles(prev => prev.map(file => {
      if (file.id !== fileId) return file;
      return {
        ...file,
        columns: file.columns.map(col => 
          col.csvColumn === csvColumn ? { ...col, ...updates } : col
        )
      };
    }));
  }, []);

  // Update file settings
  const updateFile = useCallback((fileId: string, updates: Partial<CSVFile>) => {
    setCsvFiles(prev => prev.map(file => 
      file.id === fileId ? { ...file, ...updates } : file
    ));
  }, []);

  // Check if has any relations
  const hasRelations = useMemo(() => {
    return csvFiles.some(f => f.columns.some(c => c.isRelation));
  }, [csvFiles]);

  // Create all tables and import data
  const handleCreate = useCallback(async () => {
    setCreating(true);
    setStep('creating');
    
    const total = csvFiles.length;
    const createdTablesList: Array<{ id: number; name: string; fileId: string }> = [];
    
    try {
      // Phase 1: Create all tables and columns
      setProgress({ current: 0, total: total * 2, status: 'Создание таблиц...' });
      
      for (let i = 0; i < csvFiles.length; i++) {
        const file = csvFiles[i];
        setProgress({ current: i + 1, total: total * 2, status: `Создание таблицы: ${file.tableDisplayName}` });
        
        // Create table
        const tableResponse = await tablesApi.createTable({
          name: file.tableName,
          displayName: file.tableDisplayName,
          description: `Импорт из CSV: ${file.name}`,
          icon: file.icon || '📊',
          projectId
        });
        
        const tableId = tableResponse.table.id;
        createdTablesList.push({ id: tableId, name: file.tableDisplayName, fileId: file.id });

        if (file.showInMenu) {
          try {
            const dashboardResponse = await apiClient.request<{ data: { id: number } }>(
              `/projects/${projectId}/dashboard`
            );
            await apiClient.request(`/dashboards/${dashboardResponse.data.id}/widgets`, {
              method: 'POST',
              body: JSON.stringify({
                widget_type: 'preset',
                preset_name: 'table_view',
                title: file.tableDisplayName || file.tableName,
                icon: file.icon || '📊',
                description: `Импорт из CSV: ${file.name}`,
                config: { table_id: tableId },
                position: { x: 0, y: 0, w: 12, h: 6 }
              })
            });
            queryClient.invalidateQueries({ queryKey: ['project-widgets', projectId] });
            queryClient.invalidateQueries({ queryKey: ['widgets'] });
          } catch (widgetError) {
            logger.error('Failed to create widget from CSV:', widgetError);
          }
        }
        
        // Create columns (including relation columns)
        for (const col of file.columns) {
          if (col.name === 'id') continue;
          
          try {
            const columnType = col.isRelation ? 'relation' : col.type;
            await tablesApi.createColumn(tableId, {
              name: col.name,
              displayName: col.displayName,
              type: columnType,
              config: col.isRelation ? {
                relation: {
                  enabled: true,
                  tableId: '', // Will update later
                  valueColumn: 'id',
                  labelColumn: col.relationConfig?.labelColumn || 'name'
                }
              } : undefined
            });
          } catch (err) {
            logger.warn(`Column create error: ${col.name}`, err);
          }
        }
        
        // Update file with created table ID
        setCsvFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, createdTableId: tableId, processed: true } : f
        ));
      }
      
      // Phase 2: Import data with Notion relation conversion
      setProgress({ current: total, total: total * 2, status: 'Импорт данных...' });
      
      for (let i = 0; i < csvFiles.length; i++) {
        const file = csvFiles[i];
        const createdTable = createdTablesList.find(t => t.fileId === file.id);
        if (!createdTable) continue;
        
        setProgress({ current: total + i + 1, total: total * 2, status: `Импорт данных: ${file.tableDisplayName}` });
        
        const dataRows = file.data.slice(1);
        
        // Ensure headers is a valid array
        const headers = Array.isArray(file.headers) ? file.headers : [];
        
        // Process rows
        const rows = dataRows.map(row => {
          const obj: Record<string, unknown> = {};
          
          headers.forEach((header, idx) => {
            const col = file.columns.find(c => c.csvColumn === header);
            if (!col) return;
            
            const value = row[idx];
            
            if (col.isRelation && col.relationConfig?.convertNotion) {
              // Parse Notion format and store as text for now
              // Relations will be linked after all tables are created
              const names = parseNotionRelation(value);
              obj[col.name] = names.join(', ');
            } else {
              obj[col.name] = convertValue(value, col.type);
            }
          });
          
          return obj;
        });
        
        // Import rows
        await tablesApi.importRows(createdTable.id, {
          rows,
          mode: 'add',
          idMapping: null,
          addNewIds: true
        });
      }
      
      // Phase 3: Update relation columns with correct table IDs
      setProgress({ current: total * 2, total: total * 2, status: 'Настройка связей...' });
      
      for (const file of csvFiles) {
        const createdTable = createdTablesList.find(t => t.fileId === file.id);
        if (!createdTable) continue;
        
        for (const col of file.columns) {
          if (!col.isRelation || !col.relationConfig?.targetFileId) continue;
          
          const targetTable = createdTablesList.find(t => t.fileId === col.relationConfig!.targetFileId);
          if (!targetTable) continue;
          
          // Update column config with target table ID
          try {
            // This would require an API endpoint to update column config
            logger.debug(`Link ${col.name} in ${createdTable.name} to ${targetTable.name}`);
          } catch (err) {
            logger.warn('Relation update error:', err);
          }
        }
      }
      
      setCreatedTables(createdTablesList.map(t => ({ id: t.id, name: t.name })));
      setStep('done');
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['project-tables', projectId] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      
    } catch (err) {
      logger.error('Import error:', err);
      setCreating(false);
    }
  }, [csvFiles, projectId, queryClient]);

  // Render step content
  const renderUploadStep = () => (
    <div className="space-y-6">
      <div 
        className="border-2 border-dashed border-gray-600 rounded-xl p-12 text-center hover:border-primary-500 transition-colors cursor-pointer"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => document.getElementById('multi-csv-input')?.click()}
      >
        <input
          id="multi-csv-input"
          type="file"
          accept=".csv"
          multiple
          onChange={handleFilesUpload}
          className="hidden"
        />
        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="text-lg font-medium">Перетащите CSV файлы сюда</p>
        <p className="text-sm text-gray-400 mt-2">или нажмите для выбора файлов</p>
        <p className="text-xs text-gray-500 mt-4">
          Поддерживается множественный выбор • Связи между таблицами настраиваются на следующем шаге
        </p>
      </div>
      
      {csvFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-400">Загруженные файлы ({csvFiles.length}):</h4>
          {csvFiles.map(file => (
            <div key={file.id} className="flex items-center gap-3 p-3 bg-dark-700 rounded-lg">
              <Table className="w-5 h-5 text-primary-400" />
              <span className="flex-1">{file.name}</span>
              <span className="text-sm text-gray-400">{file.data.length - 1} строк</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderConfigureStep = () => {
    if (!currentFile) return null;
    
    return (
      <div className="space-y-6">
        {/* Table info */}
        <div className="space-y-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              Информация о таблице ({currentFileIndex + 1}/{csvFiles.length})
            </h4>
            {csvFiles.length > 1 && (
              <span className="text-xs text-[var(--text-tertiary)]">
                Будет создано {csvFiles.length} таблиц
              </span>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="w-16">
              <label className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1">
                Иконка
              </label>
              <EmojiPicker
                value={currentFile.icon}
                onChange={(emoji) => updateFile(currentFile.id, { icon: emoji })}
                size="sm"
                label=""
                portal
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1">
                Название
              </label>
              <input
                type="text"
                value={currentFile.tableDisplayName}
                onChange={(e) => updateFile(currentFile.id, { tableDisplayName: e.target.value })}
                className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                placeholder="Имя таблицы"
              />
            </div>
            <div className="w-40">
              <label className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1">
                Системное имя
              </label>
              <input
                type="text"
                value={currentFile.tableName}
                onChange={(e) => updateFile(currentFile.id, { tableName: e.target.value })}
                className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                placeholder="table_key"
              />
            </div>
          </div>

          <TableMenuWidgetToggle
            checked={currentFile.showInMenu}
            onCheckedChange={(checked) => updateFile(currentFile.id, { showInMenu: checked })}
            title="Отображать в меню"
            description="Создать виджет таблицы в левом меню"
          />
        </div>
        
        {/* Columns configuration */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <span>Колонки ({currentFile.columns.length})</span>
            {currentFile.columns.some(c => c.isRelation) && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Notion связи обнаружены
              </span>
            )}
          </h4>
          
          <div className="space-y-2">
            {currentFile.columns.map(col => (
              <div key={col.csvColumn} className="p-3 bg-dark-700 rounded-lg">
                <div className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-3">
                    <Input
                      size="sm"
                      value={col.displayName}
                      onChange={(e) => updateColumn(currentFile.id, col.csvColumn, { displayName: e.target.value })}
                      placeholder="Название"
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      size="sm"
                      value={col.name}
                      onChange={(e) => updateColumn(currentFile.id, col.csvColumn, { name: e.target.value })}
                      placeholder="key"
                    />
                  </div>
                  <div className="col-span-3">
                    <Select
                      options={[
                        ...CSV_COLUMN_TYPES,
                        { value: 'relation', label: '🔗 Связь' }
                      ]}
                      value={col.type}
                      onChange={(v) => updateColumn(currentFile.id, col.csvColumn, { 
                        type: v,
                        isRelation: v === 'relation',
                        relationConfig: v === 'relation' ? { targetFileId: '', labelColumn: 'name', convertNotion: true } : undefined
                      })}
                    />
                  </div>
                  <div className="col-span-3">
                    {col.isRelation && (
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-yellow-400" />
                        <Select
                          options={[
                            { value: '', label: 'Выберите таблицу...' },
                            ...csvFiles.filter(f => f.id !== currentFile.id).map(f => ({
                              value: f.id,
                              label: f.tableDisplayName
                            }))
                          ]}
                          value={col.relationConfig?.targetFileId || ''}
                          onChange={(v) => updateColumn(currentFile.id, col.csvColumn, {
                            relationConfig: { ...col.relationConfig!, targetFileId: v }
                          })}
                        />
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Preview */}
                <div className="mt-2 text-xs text-gray-500">
                  Примеры: {currentFile.data.slice(1, 4).map(r => r[currentFile.headers.indexOf(col.csvColumn)]).filter(Boolean).slice(0, 2).join(' • ') || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderCreatingStep = () => (
    <div className="py-12 text-center space-y-6">
      <Loader2 className="w-16 h-16 mx-auto animate-spin text-primary-400" />
      <div>
        <p className="text-lg font-medium">{progress.status}</p>
        <p className="text-sm text-gray-400 mt-2">
          {progress.current} / {progress.total}
        </p>
        <div className="w-full bg-dark-700 rounded-full h-2 mt-4">
          <div 
            className="bg-primary-500 h-2 rounded-full transition-all"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );

  const renderDoneStep = () => (
    <div className="py-12 text-center space-y-6">
      <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
        <Check className="w-8 h-8 text-green-400" />
      </div>
      <div>
        <p className="text-lg font-medium">Импорт завершён!</p>
        <p className="text-sm text-gray-400 mt-2">
          Создано {createdTables.length} таблиц
        </p>
      </div>
      <div className="space-y-2">
        {createdTables.map(table => (
          <Button
            key={table.id}
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              onOpenChange(false);
              navigate(`/tables/${table.id}`);
            }}
          >
            <Table className="w-4 h-4 mr-2" />
            {table.name}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) resetState();
        onOpenChange(open);
      }}
      title="Импорт из CSV"
      size="xl"
    >
      <div className="p-6">
        {step === 'configure' && csvFiles.length > 0 && (
          <div className="sticky top-0 z-20 -mx-6 px-6 pb-3 pt-2 bg-[var(--bg-primary)] border-b border-[var(--border-primary)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollTabs('left')}
                disabled={!canScrollTabsLeft}
                className={`p-1.5 rounded-md border border-[var(--border-primary)] transition ${
                  canScrollTabsLeft
                    ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                    : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
                }`}
                title="Прокрутить влево"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div
                ref={tabsRef}
                onScroll={updateTabsScroll}
                className="flex-1 overflow-x-auto overflow-y-hidden"
              >
                <div className="flex gap-1">
                  {csvFiles.map((file, idx) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setCurrentFileIndex(idx)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition ${
                        idx === currentFileIndex
                          ? 'bg-[var(--color-primary-500)] text-white'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span>{file.icon || '📊'}</span>
                      <span className="max-w-[140px] truncate">{file.tableDisplayName}</span>
                      <span className="text-xs opacity-70">({file.data.length - 1})</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => scrollTabs('right')}
                disabled={!canScrollTabsRight}
                className={`p-1.5 rounded-md border border-[var(--border-primary)] transition ${
                  canScrollTabsRight
                    ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                    : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
                }`}
                title="Прокрутить вправо"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Steps indicator */}
        {step !== 'done' && (
          <div className="flex items-center justify-center gap-4 mb-8">
            {['upload', 'configure', 'creating'].map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s ? 'bg-primary-500 text-white' :
                  ['upload', 'configure', 'creating'].indexOf(step) > i ? 'bg-green-500 text-white' :
                  'bg-dark-600 text-gray-400'
                }`}>
                  {['upload', 'configure', 'creating'].indexOf(step) > i ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-sm ${step === s ? 'text-white' : 'text-gray-400'}`}>
                  {s === 'upload' ? 'Загрузка' : s === 'configure' ? 'Настройка' : 'Создание'}
                </span>
                {i < 2 && <ChevronRight className="w-4 h-4 text-gray-600" />}
              </div>
            ))}
          </div>
        )}
        
        {/* Step content */}
        {step === 'upload' && renderUploadStep()}
        {step === 'configure' && renderConfigureStep()}
        {step === 'creating' && renderCreatingStep()}
        {step === 'done' && renderDoneStep()}
        
        {/* Actions */}
        {step !== 'creating' && step !== 'done' && (
          <div className="flex justify-between mt-8 pt-6 border-t border-dark-600">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            
            <div className="flex gap-3">
              {step === 'configure' && (
                <>
                  <Button variant="outline" onClick={() => setStep('upload')}>
                    <ChevronLeft className="w-4 h-4 mr-2" /> Назад
                  </Button>
                  <Button onClick={handleCreate} disabled={csvFiles.length === 0}>
                    Создать {csvFiles.length} {csvFiles.length === 1 ? 'таблицу' : 'таблицы'}
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              )}
              
              {step === 'upload' && csvFiles.length > 0 && (
                <Button onClick={() => setStep('configure')}>
                  Далее <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        )}
        
        {step === 'done' && (
          <div className="flex justify-center mt-8 pt-6 border-t border-dark-600">
            <Button onClick={() => {
              resetState();
              onOpenChange(false);
            }}>
              Готово
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default MultiCSVImportModal;
