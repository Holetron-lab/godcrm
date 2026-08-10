/**
 * ImportModal - Unified import modal with JSON/CSV tabs
 * JSON import is embedded, CSV opens dedicated CSVImportModal
 */

import { logger } from '@/shared/utils/logger';
import { useState, useCallback, useMemo } from 'react';
import { Modal, Button } from '@/shared/components/ui';
import { Upload, FileJson2, FileSpreadsheet, AlertTriangle, Package, Table, Layers, Check } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import type { ColumnModel } from '../../types/table.types';

export type ImportFormat = 'json' | 'csv';
type ImportScope = 'table' | 'project' | 'space';

interface ImportPreview {
  scope: ImportScope;
  tableName?: string;
  projectName?: string;
  spaceName?: string;
  columnsCount: number;
  rowsCount: number;
  tablesCount?: number;
  hasDocuments?: boolean;
  exportedAt?: string;
  version?: string;
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  // For table context
  tableId?: string;
  tableName?: string;
  columns?: ColumnModel[];
  // For project/space context  
  projectId?: string;
  projectName?: string;
  spaceId?: string;
  spaceName?: string;
  // CSV import handler
  onImportCSV?: (data: {
    rows: Record<string, unknown>[];
    mode: 'add' | 'update';
    idMapping: { csvColumn: string; tableColumn: string } | null;
    addNewIds: boolean;
  }) => Promise<void>;
  // Initial tab
  initialFormat?: ImportFormat;
}

export const ImportModal = ({
  isOpen,
  onClose,
  tableId,
  tableName,
  columns = [],
  projectId,
  projectName,
  spaceId,
  spaceName,
  onImportCSV,
  initialFormat = 'json',
}: ImportModalProps) => {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ImportFormat>(initialFormat);
  
  // JSON import state
  const [isDragOver, setIsDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jsonData, setJsonData] = useState<unknown | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  // CSV state - for step tracking
  const [csvStep, setCsvStep] = useState<'upload' | 'done'>('upload');
  const [csvFile, setCsvFile] = useState<File | null>(null);

  // Detect export scope from JSON structure
  const detectScope = (data: Record<string, unknown>): ImportScope => {
    if (data.tables && Array.isArray(data.tables)) {
      return data.spaces ? 'space' : 'project';
    }
    return 'table';
  };

  // Generate preview from JSON data
  const generatePreview = (data: Record<string, unknown>): ImportPreview => {
    const scope = detectScope(data);
    
    if (scope === 'table') {
      return {
        scope: 'table',
        tableName: data.tableName as string,
        columnsCount: Array.isArray(data.columns) ? data.columns.length : 0,
        rowsCount: Array.isArray(data.rows) ? data.rows.length : 0,
        exportedAt: data.exportedAt as string,
        version: data.version as string,
      };
    }
    
    if (scope === 'project') {
      const tables = data.tables as Array<Record<string, unknown>>;
      return {
        scope: 'project',
        projectName: data.projectName as string,
        columnsCount: tables.reduce((sum, t) => sum + (Array.isArray(t.columns) ? t.columns.length : 0), 0),
        rowsCount: tables.reduce((sum, t) => sum + (Array.isArray(t.rows) ? t.rows.length : 0), 0),
        tablesCount: tables.length,
        hasDocuments: data.documents !== undefined,
        exportedAt: data.exportedAt as string,
        version: data.version as string,
      };
    }
    
    const tables = data.tables as Array<Record<string, unknown>>;
    return {
      scope: 'space',
      spaceName: data.spaceName as string,
      columnsCount: tables.reduce((sum, t) => sum + (Array.isArray(t.columns) ? t.columns.length : 0), 0),
      rowsCount: tables.reduce((sum, t) => sum + (Array.isArray(t.rows) ? t.rows.length : 0), 0),
      tablesCount: tables.length,
      hasDocuments: data.documents !== undefined,
      exportedAt: data.exportedAt as string,
      version: data.version as string,
    };
  };

  // Parse JSON file
  const handleJSONFile = useCallback((file: File) => {
    setError(null);
    setFile(file);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        
        if (!data || typeof data !== 'object') {
          setError('Некорректный JSON файл');
          return;
        }
        
        if (!data.version && !data.exportedAt) {
          setError('Этот файл не похож на экспорт GOD CRM');
          return;
        }
        
        setJsonData(data);
        setPreview(generatePreview(data as Record<string, unknown>));
      } catch (err) {
        setError('Ошибка парсинга JSON файла');
        logger.error('Import error:', err);
      }
    };
    reader.readAsText(file);
  }, []);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;

    if (format === 'json') {
      if (droppedFile.type === 'application/json' || droppedFile.name.endsWith('.json')) {
        handleJSONFile(droppedFile);
      } else {
        setError('Пожалуйста, загрузите JSON файл');
      }
    } else {
      if (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv')) {
        setCsvFile(droppedFile);
        // Here you would trigger the CSV import modal or process
        setError('CSV импорт будет доступен в следующей версии');
      } else {
        setError('Пожалуйста, загрузите CSV файл');
      }
    }
  }, [format, handleJSONFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (format === 'json') {
        handleJSONFile(selectedFile);
      } else {
        setCsvFile(selectedFile);
      }
    }
  }, [format, handleJSONFile]);

  // Perform JSON import
  const handleImport = async () => {
    if (!jsonData || !preview) return;
    
    setIsImporting(true);
    setError(null);
    
    try {
      let endpoint: string;
      let body: Record<string, unknown>;
      
      if (preview.scope === 'table' && tableId) {
        endpoint = `/api/v3/tables/${tableId}/import`;
        body = { data: jsonData, mode: importMode };
      } else if (preview.scope === 'project' && projectId) {
        endpoint = `/api/v3/projects/${projectId}/import`;
        body = { data: jsonData, mode: importMode };
      } else if (preview.scope === 'space' && spaceId) {
        endpoint = `/api/v3/spaces/${spaceId}/import`;
        body = { data: jsonData, mode: importMode };
      } else {
        throw new Error('Не указан целевой объект для импорта');
      }
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Ошибка импорта');
      }
      
      const result = await res.json();
      
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      queryClient.invalidateQueries({ queryKey: ['columns'] });
      
      const stats = result.data?.stats || {};
      showToast(
        `Импорт завершён: добавлено ${stats.rowsAdded || 0} строк, обновлено ${stats.rowsUpdated || 0}`,
        'success'
      );
      
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
      logger.error('Import failed:', err);
    } finally {
      setIsImporting(false);
    }
  };

  const resetState = useCallback(() => {
    setFile(null);
    setJsonData(null);
    setPreview(null);
    setError(null);
    setImportMode('merge');
    setIsDragOver(false);
    setCsvFile(null);
    setCsvStep('upload');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Scope icon and label
  const getScopeInfo = (scope: ImportScope) => {
    switch (scope) {
      case 'table':
        return { icon: Table, label: 'Таблица', color: 'text-blue-500' };
      case 'project':
        return { icon: Package, label: 'Проект', color: 'text-purple-500' };
      case 'space':
        return { icon: Layers, label: 'Пространство', color: 'text-green-500' };
    }
  };

  const acceptTypes = format === 'json' ? '.json,application/json' : '.csv,text/csv';
  const formatIcon = format === 'json' ? FileJson2 : FileSpreadsheet;
  const FormatIcon = formatIcon;

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && handleClose()} 
      title="Импорт данных"
      size="md"
    >
      <div className="space-y-6">
        {/* Format tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg">
          <button
            type="button"
            onClick={() => { setFormat('json'); resetState(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
              format === 'json'
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <FileJson2 className="w-4 h-4" />
            JSON
            <span className="text-xs opacity-70">(GOD CRM)</span>
          </button>
          <button
            type="button"
            onClick={() => { setFormat('csv'); resetState(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
              format === 'csv'
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          </div>
        )}

        {/* Upload zone - common for both formats when no file */}
        {!preview && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
              isDragOver 
                ? "border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10"
                : "border-[var(--border-primary)] hover:border-[var(--color-primary-500)]/50"
            )}
            onClick={() => document.getElementById('import-file-input')?.click()}
          >
            <input
              id="import-file-input"
              type="file"
              accept={acceptTypes}
              className="hidden"
              onChange={handleFileInput}
            />
            <FormatIcon className={cn(
              "w-12 h-12 mx-auto mb-4 transition-colors",
              isDragOver ? "text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)]"
            )} />
            <div className="text-[var(--text-primary)] font-medium mb-1">
              Перетащите {format === 'json' ? 'JSON' : 'CSV'} файл сюда
            </div>
            <div className="text-sm text-[var(--text-tertiary)]">
              или нажмите для выбора файла
            </div>
            {format === 'json' && (
              <div className="text-xs text-[var(--text-tertiary)] mt-2">
                Поддерживаются файлы экспорта GOD CRM
              </div>
            )}
            {format === 'csv' && (
              <div className="text-xs text-[var(--text-tertiary)] mt-2">
                Поддерживаются CSV с разделителем запятая (,) или точка с запятой (;)
              </div>
            )}
          </div>
        )}

        {/* JSON Preview */}
        {format === 'json' && preview && (
          <>
            {/* File info */}
            <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded-lg">
              {(() => {
                const { icon: Icon, label, color } = getScopeInfo(preview.scope);
                return (
                  <>
                    <Icon className={cn("w-8 h-8", color)} />
                    <div className="flex-1">
                      <div className="font-medium text-[var(--text-primary)]">
                        {preview.tableName || preview.projectName || preview.spaceName || label}
                      </div>
                      <div className="text-sm text-[var(--text-tertiary)]">
                        {preview.scope === 'table' 
                          ? `${preview.columnsCount} колонок, ${preview.rowsCount} строк`
                          : `${preview.tablesCount} таблиц, ${preview.rowsCount} строк`
                        }
                      </div>
                    </div>
                    <button
                      onClick={resetState}
                      className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline"
                    >
                      Другой файл
                    </button>
                  </>
                );
              })()}
            </div>

            {/* Import mode */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Режим импорта:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'merge' as const, label: 'Объединить', description: 'Добавить и обновить' },
                  { value: 'replace' as const, label: 'Заменить', description: 'Удалить и создать заново' },
                ].map(option => (
                  <label 
                    key={option.value} 
                    className={cn(
                      "flex items-center gap-2 p-3 rounded-lg cursor-pointer transition border",
                      importMode === option.value 
                        ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                        : "hover:bg-[var(--bg-tertiary)] border-transparent"
                    )}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === option.value}
                      onChange={() => setImportMode(option.value)}
                      className="w-4 h-4 text-[var(--color-primary-500)]"
                    />
                    <div>
                      <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                      <span className="block text-xs text-[var(--text-tertiary)]">{option.description}</span>
                    </div>
                    {importMode === option.value && (
                      <Check className="w-4 h-4 text-[var(--color-primary-500)] ml-auto" />
                    )}
                  </label>
                ))}
              </div>
            </div>

            {/* Replace warning */}
            {importMode === 'replace' && (
              <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-600 dark:text-amber-400">
                  Все существующие данные будут удалены перед импортом!
                </div>
              </div>
            )}

            {/* Export info */}
            {preview.exportedAt && (
              <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-4">
                <span>Экспортировано: {new Date(preview.exportedAt).toLocaleString('ru-RU')}</span>
                {preview.version && <span>Версия: {preview.version}</span>}
              </div>
            )}
          </>
        )}

        <hr className="border-[var(--border-primary)]" />

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <Button onClick={handleClose} variant="secondary">
            Отмена
          </Button>
          {format === 'json' && (
            <Button
              onClick={handleImport}
              variant="primary"
              className="gap-2"
              disabled={!preview || isImporting}
            >
              <Upload className="w-4 h-4" />
              {isImporting ? 'Импорт...' : 'Импортировать'}
            </Button>
          )}
          {format === 'csv' && csvFile && (
            <Button
              onClick={() => {
                // This would trigger the complex CSV import flow
                showToast('CSV импорт в разработке', 'info');
              }}
              variant="primary"
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Далее
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ImportModal;
