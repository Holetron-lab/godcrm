import { useState, useCallback, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal, Input } from '@/shared/components/ui';
import { Upload, FileSpreadsheet, ArrowRight, Plus, ChevronDown, Table, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useCreateTable } from '../../hooks/useCreateTable';
import { tablesApi } from '../../api/tablesApi';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getColumnTypeOptionsForCSV } from '@/shared/types';
import { apiClient } from '@/shared/utils/apiClient';
import { EmojiPicker } from '../UniversalTable/EmojiPicker';
import { TableMenuWidgetToggle } from '../TableMenuWidgetToggle';

interface ColumnDefinition {
  csvColumn: string;
  name: string;
  displayName: string;
  type: string;
}

interface CreateTableFromCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: number | null;
}

export const CreateTableFromCSVModal = ({
  isOpen,
  onClose,
  projectId
}: CreateTableFromCSVModalProps) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Column type options from shared types
  const COLUMN_TYPES = useMemo(() => getColumnTypeOptionsForCSV(language as 'ru' | 'en'), [language]);
  
  const [step, setStep] = useState<'upload' | 'configure' | 'creating'>('upload');
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [useFirstRowAsHeaders, setUseFirstRowAsHeaders] = useState(true);
  const [columnDefinitions, setColumnDefinitions] = useState<ColumnDefinition[]>([]);
  const [tableName, setTableName] = useState('');
  const [tableDisplayName, setTableDisplayName] = useState('');
  const [tableIcon, setTableIcon] = useState('📊');
  const [showInMenu, setShowInMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse CSV file
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    
    // Extract filename without extension for table name
    const fileName = file.name.replace(/\.csv$/i, '');
    setTableDisplayName(fileName);
    setTableName(fileName.toLowerCase().replace(/[^a-z0-9_]/gi, '_'));
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);
        
        if (rows.length < 2) {
          setError('CSV файл должен содержать хотя бы заголовок и одну строку данных');
          return;
        }

        setCsvData(rows);
        const headers = rows[0];
        setCsvHeaders(headers);

        // Create column definitions
        const definitions: ColumnDefinition[] = headers.map(csvCol => ({
          csvColumn: csvCol,
          name: csvCol.toLowerCase().replace(/[^a-z0-9_]/gi, '_'),
          displayName: csvCol,
          type: guessColumnType(csvCol, rows.slice(1).map(r => r[headers.indexOf(csvCol)]))
        }));
        setColumnDefinitions(definitions);
        setStep('configure');
      } catch (err) {
        setError('Ошибка парсинга CSV файла');
        logger.error('Import error:', err);
      }
    };
    reader.readAsText(file);
  }, []);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      const input = document.createElement('input');
      input.type = 'file';
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      handleFileUpload({ target: input } as React.ChangeEvent<HTMLInputElement>);
    } else {
      setError('Пожалуйста, загрузите CSV файл');
    }
  }, [handleFileUpload]);

  // Update column definition
  const updateColumn = useCallback((csvColumn: string, field: keyof ColumnDefinition, value: string) => {
    setColumnDefinitions(prev => prev.map(def => 
      def.csvColumn === csvColumn ? { ...def, [field]: value } : def
    ));
  }, []);

  // Preview data
  const previewRows = useMemo(() => {
    if (csvData.length < 2) return [];
    const dataRows = useFirstRowAsHeaders ? csvData.slice(1) : csvData;
    return dataRows.slice(0, 3);
  }, [csvData, useFirstRowAsHeaders]);

  const dataRowsCount = useMemo(() => {
    return useFirstRowAsHeaders ? csvData.length - 1 : csvData.length;
  }, [csvData, useFirstRowAsHeaders]);

  // Create table and import data
  const handleCreate = useCallback(async () => {
    if (!tableName.trim() || !projectId) {
      setError('Введите имя таблицы');
      return;
    }

    setCreating(true);
    setStep('creating');
    setError(null);

    try {
      // 1. Create table
      const tableResponse = await tablesApi.createTable({
        name: tableName,
        displayName: tableDisplayName || tableName,
        description: `Создана из CSV файла`,
        icon: tableIcon,
        projectId: projectId
      });

      const newTableId = tableResponse.table.id;

      if (showInMenu) {
        try {
          const dashboardResponse = await apiClient.request<{ data: { id: number } }>(
            `/projects/${projectId}/dashboard`
          );
          await apiClient.request(`/dashboards/${dashboardResponse.data.id}/widgets`, {
            method: 'POST',
            body: JSON.stringify({
              widget_type: 'preset',
              preset_name: 'table_view',
              title: tableDisplayName || tableName,
              icon: tableIcon,
              description: 'Создана из CSV файла',
              config: { table_id: newTableId },
              position: { x: 0, y: 0, w: 12, h: 6 }
            })
          });
          queryClient.invalidateQueries({ queryKey: ['project-widgets', projectId] });
          queryClient.invalidateQueries({ queryKey: ['widgets'] });
        } catch (widgetError) {
          logger.error('Failed to create widget from CSV:', widgetError);
        }
      }

      // 2. Create columns (skip id column as it's auto-created)
      for (const col of columnDefinitions) {
        if (col.name !== 'id') {
          try {
            await tablesApi.createColumn(newTableId, {
              name: col.name,
              displayName: col.displayName,
              type: col.type
            });
          } catch (err) {
            logger.warn(`Failed to create column ${col.name}:`, err);
          }
        }
      }

      // 3. Prepare rows data
      const dataRows = useFirstRowAsHeaders ? csvData.slice(1) : csvData;
      const rows = dataRows.map(row => {
        const obj: Record<string, unknown> = {};
        csvHeaders.forEach((header, i) => {
          const def = columnDefinitions.find(d => d.csvColumn === header);
          if (def) {
            obj[def.name] = convertValue(row[i], def.type);
          }
        });
        return obj;
      });

      // 4. Import rows
      await tablesApi.importRows(newTableId, {
        rows,
        mode: 'add',
        idMapping: null,
        addNewIds: true
      });

      // 5. Invalidate queries and navigate
      queryClient.invalidateQueries({ queryKey: ['project-tables', projectId] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      
      // Reset and close
      resetState();
      onClose();
      
      // Navigate to new table
      navigate(`/tables/${newTableId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания таблицы');
      setStep('configure');
    } finally {
      setCreating(false);
    }
  }, [tableName, tableDisplayName, tableIcon, projectId, columnDefinitions, csvData, csvHeaders, useFirstRowAsHeaders, queryClient, onClose, navigate]);

  const resetState = useCallback(() => {
    setStep('upload');
    setCsvData([]);
    setCsvHeaders([]);
    setColumnDefinitions([]);
    setTableName('');
    setTableDisplayName('');
    setTableIcon('📊');
    setShowInMenu(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (!creating) {
      resetState();
      onClose();
    }
  }, [resetState, onClose, creating]);

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && handleClose()} 
      title={t('table.createFromCsv')}
      size="lg"
    >
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[var(--border-primary)] rounded-xl p-8 text-center hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/5 transition-all cursor-pointer"
            >
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-create-upload"
              />
              <label htmlFor="csv-create-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
                <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
                  Перетащите CSV файл сюда
                </p>
                <p className="text-sm text-[var(--text-secondary)]">
                  или нажмите для выбора файла
                </p>
              </label>
            </div>

            <div className="text-sm text-[var(--text-tertiary)] text-center">
              Структура таблицы будет создана автоматически на основе колонок CSV
            </div>

            {!projectId && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">Выберите проект для создания таблицы</span>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="space-y-6">
            {/* Table Info */}
            <div className="space-y-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Информация о таблице
              </h4>
              
              <div className="flex items-start gap-3">
                <div className="w-20">
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Иконка
                  </label>
                  <EmojiPicker
                    value={tableIcon}
                    onChange={(emoji) => setTableIcon(emoji)}
                    size="sm"
                    label=""
                    portal
                  />
                </div>
                <div className="flex-1 min-w-0 ml-5">
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Название таблицы
                  </label>
                  <input
                    type="text"
                    value={tableDisplayName}
                    onChange={(e) => {
                      setTableDisplayName(e.target.value);
                      setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/gi, '_'));
                    }}
                    placeholder="Моя таблица"
                    className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                  />
                </div>
              </div>

              <TableMenuWidgetToggle
                checked={showInMenu}
                onCheckedChange={setShowInMenu}
                title="Отображать в меню"
                description="Создать виджет таблицы в левом меню"
              />
            </div>

            {/* First Row as Headers */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useFirstRowAsHeaders}
                onChange={(e) => setUseFirstRowAsHeaders(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--color-primary-500)]"
              />
              <span className="text-sm text-[var(--text-primary)]">
                Использовать первую строку как заголовки
              </span>
            </label>

            {/* Column Definitions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  Колонки ({columnDefinitions.length})
                </h4>
              </div>

              <div className="space-y-2">
                {columnDefinitions.map((def) => (
                  <div 
                    key={def.csvColumn}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
                  >
                    {/* Column Display Name */}
                    <input
                      type="text"
                      value={def.displayName}
                      onChange={(e) => {
                        updateColumn(def.csvColumn, 'displayName', e.target.value);
                        updateColumn(def.csvColumn, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/gi, '_'));
                      }}
                      className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    />

                    {/* Type Select */}
                    <select
                      value={def.type}
                      onChange={(e) => updateColumn(def.csvColumn, 'type', e.target.value)}
                      className="w-36 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    >
                      {COLUMN_TYPES.map(t => (
                        <option key={t.value} value={t.value}>
                          {t.icon} {t.label}
                        </option>
                      ))}
                    </select>

                    {/* Sample Value */}
                    <div className="w-32 text-xs text-[var(--text-tertiary)] truncate">
                      {csvData[1]?.[csvHeaders.indexOf(def.csvColumn)]?.slice(0, 20) || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-[var(--text-secondary)]" />
                <h4 className="text-sm font-medium text-[var(--text-secondary)]">
                  Предпросмотр ({dataRowsCount} строк)
                </h4>
              </div>
              
              <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-secondary)]">
                    <tr>
                      {columnDefinitions.map(def => (
                        <th key={def.csvColumn} className="px-3 py-2 text-left font-medium text-[var(--text-secondary)] whitespace-nowrap">
                          {def.displayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-[var(--border-primary)]">
                        {csvHeaders.map((header, j) => (
                          <td key={j} className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap max-w-[150px] truncate">
                            {row[j] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-primary)]">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              >
                ← Назад
              </button>
              
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !tableName.trim() || !projectId}
                  className="px-6 py-2 rounded-lg bg-[var(--color-primary-500)] text-white font-medium hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Создать таблицу
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Creating */}
        {step === 'creating' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-[var(--color-primary-500)] animate-spin" />
            <p className="text-lg font-medium text-[var(--text-primary)]">
              Создаём таблицу...
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Создание колонок и импорт {dataRowsCount} строк
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

// Parse CSV with support for both comma and semicolon delimiters
function parseCSV(text: string): string[][] {
  // Detect delimiter
  const firstLine = text.split('\n')[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(cell => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
        if (char === '\r') i++; // Skip \n after \r
      } else if (char !== '\r') {
        currentCell += char;
      }
    }
  }

  // Add last cell and row
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Guess column type from values
function guessColumnType(name: string, values: string[]): string {
  const nameLower = name.toLowerCase();
  
  // Name-based guessing
  if (nameLower.includes('email')) return 'email';
  if (nameLower.includes('phone') || nameLower.includes('tel')) return 'phone';
  if (nameLower.includes('url') || nameLower.includes('link') || nameLower.includes('website')) return 'url';
  if (nameLower.includes('date') || nameLower.includes('created') || nameLower.includes('updated')) return 'date';
  if (nameLower.includes('amount') || nameLower.includes('price') || nameLower.includes('cost') || nameLower.includes('total')) return 'number';
  
  // Value-based guessing
  const sampleValues = values.filter(v => v && v.trim()).slice(0, 10);
  if (sampleValues.length === 0) return 'text';

  // Check if all values are numbers
  if (sampleValues.every(v => !isNaN(Number(v.replace(',', '.'))))) {
    return 'number';
  }

  // Check if all values are booleans
  const boolValues = ['true', 'false', '1', '0', 'yes', 'no', 'да', 'нет'];
  if (sampleValues.every(v => boolValues.includes(v.toLowerCase()))) {
    return 'checkbox';
  }

  // Check if values look like dates
  if (sampleValues.every(v => !isNaN(Date.parse(v)))) {
    return 'date';
  }

  // Check if values look like emails
  if (sampleValues.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    return 'email';
  }

  return 'text';
}

// Convert value based on type
function convertValue(value: string, type: string): unknown {
  if (!value || value.trim() === '') return null;
  
  switch (type) {
    case 'number':
      const num = Number(value.replace(',', '.').replace(/\s/g, ''));
      return isNaN(num) ? null : num;
    case 'checkbox':
      const lower = value.toLowerCase();
      return ['true', '1', 'yes', 'да'].includes(lower);
    case 'date':
    case 'datetime':
      const date = new Date(value);
      return isNaN(date.getTime()) ? value : date.toISOString();
    default:
      return value;
  }
}
