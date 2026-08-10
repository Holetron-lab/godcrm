import { useState, useCallback, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal, Button } from '@/shared/components/ui';
import { Upload, FileJson2, AlertTriangle, Check, Package, Table, Layers } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';

type ImportScope = 'table' | 'project' | 'space';

interface ImportJSONModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId?: string;
  tableName?: string;
  projectId?: string;
  projectName?: string;
  spaceId?: string;
  spaceName?: string;
}

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

export const ImportJSONModal = ({
  isOpen,
  onClose,
  tableId,
  tableName,
  projectId,
  projectName,
  spaceId,
  spaceName,
}: ImportJSONModalProps) => {
  const queryClient = useQueryClient();
  const [isDragOver, setIsDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jsonData, setJsonData] = useState<unknown | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

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
    
    // space
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
  const handleFile = useCallback((file: File) => {
    setError(null);
    setFile(file);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        
        // Basic validation
        if (!data || typeof data !== 'object') {
          setError('Некорректный JSON файл');
          return;
        }
        
        // Check if it's a valid export file
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
    if (droppedFile && (droppedFile.type === 'application/json' || droppedFile.name.endsWith('.json'))) {
      handleFile(droppedFile);
    } else {
      setError('Пожалуйста, загрузите JSON файл');
    }
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFile(selectedFile);
    }
  }, [handleFile]);

  // Perform import
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
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      queryClient.invalidateQueries({ queryKey: ['columns'] });
      
      // Show success message
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

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && handleClose()} 
      title="Импорт из JSON"
      size="md"
    >
      <div className="space-y-6">
        {/* Upload zone */}
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
            onClick={() => document.getElementById('json-file-input')?.click()}
          >
            <input
              id="json-file-input"
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileInput}
            />
            <FileJson2 className={cn(
              "w-12 h-12 mx-auto mb-4 transition-colors",
              isDragOver ? "text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)]"
            )} />
            <div className="text-[var(--text-primary)] font-medium mb-1">
              Перетащите JSON файл сюда
            </div>
            <div className="text-sm text-[var(--text-tertiary)]">
              или нажмите для выбора файла
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          </div>
        )}

        {/* Preview */}
        {preview && (
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
                      Выбрать другой файл
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

        {/* Footer with buttons */}
        <div className="flex justify-end gap-3">
          <Button
            onClick={handleClose}
            variant="secondary"
          >
            Отмена
          </Button>
          <Button
            onClick={handleImport}
            variant="primary"
            className="gap-2"
            disabled={!preview || isImporting}
          >
            <Upload className="w-4 h-4" />
            {isImporting ? 'Импорт...' : 'Импортировать'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ImportJSONModal;
