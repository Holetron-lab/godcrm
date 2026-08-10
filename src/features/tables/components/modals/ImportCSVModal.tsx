import { useState, useCallback, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal } from '@/shared/components/ui';
import { Upload, FileSpreadsheet, ArrowRight, Plus, RefreshCw, ChevronDown, Table, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel } from '../../types/table.types';
import { getColumnTypeOptionsForCSV } from '@/shared/types';

type ImportMode = 'add' | 'update';

interface ColumnMapping {
  csvColumn: string;
  tableColumn: string | null;
  type: string;
}

interface ImportCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnModel[];
  onImport: (data: {
    rows: Record<string, unknown>[];
    mode: ImportMode;
    idMapping: { csvColumn: string; tableColumn: string } | null;
    addNewIds: boolean;
  }) => Promise<void>;
}

export const ImportCSVModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  onImport
}: ImportCSVModalProps) => {
  const { t, language } = useLanguage();
  
  // Column type options from shared types
  const COLUMN_TYPES = useMemo(() => getColumnTypeOptionsForCSV(language as 'ru' | 'en'), [language]);
  
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview'>('upload');
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [useFirstRowAsHeaders, setUseFirstRowAsHeaders] = useState(true);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>('add');
  const [idMapping, setIdMapping] = useState<{ csvColumn: string; tableColumn: string } | null>(null);
  const [addNewIds, setAddNewIds] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse CSV file
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
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

        // Auto-map columns by name similarity
        const mappings: ColumnMapping[] = headers.map(csvCol => {
          const matchedCol = columns.find(c => 
            c.name.toLowerCase() === csvCol.toLowerCase() ||
            c.displayName?.toLowerCase() === csvCol.toLowerCase()
          );
          return {
            csvColumn: csvCol,
            tableColumn: matchedCol?.id || null,
            type: matchedCol?.type || guessColumnType(csvCol, rows.slice(1).map(r => r[headers.indexOf(csvCol)]))
          };
        });
        setColumnMappings(mappings);
        setStep('mapping');
      } catch (err) {
        setError('Ошибка парсинга CSV файла');
        logger.error('Import error:', err);
      }
    };
    reader.readAsText(file);
  }, [columns]);

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

  // Update column mapping
  const updateMapping = useCallback((csvColumn: string, field: keyof ColumnMapping, value: string | null) => {
    setColumnMappings(prev => prev.map(m => 
      m.csvColumn === csvColumn ? { ...m, [field]: value } : m
    ));
  }, []);

  // Preview data
  const previewRows = useMemo(() => {
    if (csvData.length < 2) return [];
    const dataRows = useFirstRowAsHeaders ? csvData.slice(1) : csvData;
    return dataRows.slice(0, 5).map(row => {
      const obj: Record<string, unknown> = {};
      csvHeaders.forEach((header, i) => {
        const mapping = columnMappings.find(m => m.csvColumn === header);
        if (mapping?.tableColumn) {
          obj[mapping.tableColumn] = convertValue(row[i], mapping.type);
        }
      });
      return obj;
    });
  }, [csvData, csvHeaders, columnMappings, useFirstRowAsHeaders]);

  // Handle import
  const handleImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    
    try {
      const dataRows = useFirstRowAsHeaders ? csvData.slice(1) : csvData;
      const rows = dataRows.map(row => {
        const obj: Record<string, unknown> = {};
        csvHeaders.forEach((header, i) => {
          const mapping = columnMappings.find(m => m.csvColumn === header);
          if (mapping?.tableColumn) {
            obj[mapping.tableColumn] = convertValue(row[i], mapping.type);
          }
        });
        return obj;
      });

      await onImport({
        rows,
        mode: importMode,
        idMapping: importMode === 'update' ? idMapping : null,
        addNewIds
      });
      
      // Reset and close
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setImporting(false);
    }
  }, [csvData, csvHeaders, columnMappings, useFirstRowAsHeaders, importMode, idMapping, addNewIds, onImport, onClose]);

  const resetState = useCallback(() => {
    setStep('upload');
    setCsvData([]);
    setCsvHeaders([]);
    setColumnMappings([]);
    setImportMode('add');
    setIdMapping(null);
    setAddNewIds(true);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const mappedColumnsCount = columnMappings.filter(m => m.tableColumn).length;
  const dataRowsCount = useFirstRowAsHeaders ? csvData.length - 1 : csvData.length;

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && handleClose()} 
      title="Импорт CSV" 
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
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer">
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
              Поддерживаются файлы CSV с разделителем запятая (,) или точка с запятой (;)
            </div>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'mapping' && (
          <div className="space-y-6">
            {/* Import Mode Selection */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Режим импорта
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setImportMode('add')}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                    importMode === 'add'
                      ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                      : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    importMode === 'add' ? 'bg-green-500/20' : 'bg-[var(--bg-tertiary)]'
                  }`}>
                    <Plus className={`w-5 h-5 ${importMode === 'add' ? 'text-green-500' : 'text-[var(--text-tertiary)]'}`} />
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-[var(--text-primary)]">Добавить</div>
                    <div className="text-xs text-[var(--text-secondary)]">Новые строки</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('update')}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                    importMode === 'update'
                      ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                      : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    importMode === 'update' ? 'bg-primary-500/20' : 'bg-[var(--bg-tertiary)]'
                  }`}>
                    <RefreshCw className={`w-5 h-5 ${importMode === 'update' ? 'text-primary-500' : 'text-[var(--text-tertiary)]'}`} />
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-[var(--text-primary)]">Обновить</div>
                    <div className="text-xs text-[var(--text-secondary)]">По ID</div>
                  </div>
                </button>
              </div>
            </div>

            {/* ID Mapping for Update Mode */}
            {importMode === 'update' && (
              <div className="space-y-3 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <h4 className="text-sm font-medium text-[var(--text-primary)]">
                  Сопоставление ID для обновления
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Колонка ID в CSV
                    </label>
                    <select
                      value={idMapping?.csvColumn || ''}
                      onChange={(e) => setIdMapping(prev => ({ 
                        csvColumn: e.target.value, 
                        tableColumn: prev?.tableColumn || '' 
                      }))}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    >
                      <option value="">Выберите колонку</option>
                      {csvHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Колонка ID в таблице
                    </label>
                    <select
                      value={idMapping?.tableColumn || ''}
                      onChange={(e) => setIdMapping(prev => ({ 
                        csvColumn: prev?.csvColumn || '', 
                        tableColumn: e.target.value 
                      }))}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    >
                      <option value="">Выберите колонку</option>
                      <option value="id">ID (системный)</option>
                      {columns.map(c => (
                        <option key={c.id} value={c.id}>{c.displayName || c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={addNewIds}
                    onChange={(e) => setAddNewIds(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    Добавлять новые записи (если ID не найден в таблице)
                  </span>
                </label>
              </div>
            )}

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

            {/* Column Mappings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  Сопоставление колонок
                </h4>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {mappedColumnsCount} из {csvHeaders.length} сопоставлено
                </span>
              </div>

              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                {columnMappings.map((mapping) => (
                  <div 
                    key={mapping.csvColumn}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
                  >
                    {/* CSV Column Name */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {mapping.csvColumn}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        {csvData[1]?.[csvHeaders.indexOf(mapping.csvColumn)]?.slice(0, 30) || '—'}
                      </div>
                    </div>

                    <ArrowRight className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />

                    {/* Table Column Select */}
                    <select
                      value={mapping.tableColumn || ''}
                      onChange={(e) => updateMapping(mapping.csvColumn, 'tableColumn', e.target.value || null)}
                      className="w-40 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    >
                      <option value="">Пропустить</option>
                      {columns.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.displayName || c.name}
                        </option>
                      ))}
                    </select>

                    {/* Type Select */}
                    <select
                      value={mapping.type}
                      onChange={(e) => updateMapping(mapping.csvColumn, 'type', e.target.value)}
                      className="w-32 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm"
                    >
                      {COLUMN_TYPES.map(t => (
                        <option key={t.value} value={t.value}>
                          {t.icon} {t.label}
                        </option>
                      ))}
                    </select>
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
                      {columns.filter(c => columnMappings.some(m => m.tableColumn === c.id)).map(c => (
                        <th key={c.id} className="px-3 py-2 text-left font-medium text-[var(--text-secondary)] whitespace-nowrap">
                          {c.displayName || c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-[var(--border-primary)]">
                        {columns.filter(c => columnMappings.some(m => m.tableColumn === c.id)).map(c => (
                          <td key={c.id} className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">
                            {String(row[c.id] ?? '—')}
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
                  onClick={handleImport}
                  disabled={importing || mappedColumnsCount === 0 || (importMode === 'update' && (!idMapping?.csvColumn || !idMapping?.tableColumn))}
                  className="px-6 py-2 rounded-lg bg-[var(--color-primary-500)] text-white font-medium hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                >
                  {importing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Импорт...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Импортировать {dataRowsCount} строк
                    </>
                  )}
                </button>
              </div>
            </div>
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
