import { useState, useCallback, useMemo, useEffect } from 'react';
import { Replace, Loader2, AlertCircle, CheckCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { Button, Modal } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { 
  BulkReplaceConfig, 
  BulkReplaceOperationType,
  BulkReplaceResult, 
  ReplacePreviewItem 
} from '../../types/selection.types';
import type { ColumnModel, RowModel } from '../../types/table.types';
import { generateReplacePreview, getTargetRowIds } from '../../utils/bulkReplaceUtils';
import { BulkReplaceColumnMap } from './BulkReplaceColumnMap';

interface BulkReplaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnModel[];
  rows: RowModel[];
  selectedRowIds: Set<string | number>;
  filteredRowIds: (string | number)[];
  allRowIds: (string | number)[];
  onReplace: (config: BulkReplaceConfig) => Promise<BulkReplaceResult>;
  tableInfo?: {
    name: string;
    id: string;
    key: string;
  };
}

/**
 * Модальное окно для массовой замены значений
 */
export const BulkReplaceModal = ({
  open,
  onOpenChange,
  columns,
  rows,
  selectedRowIds,
  filteredRowIds,
  allRowIds,
  onReplace,
  tableInfo
}: BulkReplaceModalProps) => {
  const { t } = useLanguage();
  // Form state
  const [targetScope, setTargetScope] = useState<BulkReplaceConfig['targetScope']>('selected');
  const [columnId, setColumnId] = useState<string>('');
  const [operationType, setOperationType] = useState<BulkReplaceOperationType>('replace');
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [prependValue, setPrependValue] = useState('');
  const [appendValue, setAppendValue] = useState('');
  const [formulaValue, setFormulaValue] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  
  // UI state
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<BulkReplaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  
  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      // Set default scope based on selection
      if (selectedRowIds.size > 0) {
        setTargetScope('selected');
      } else if (filteredRowIds.length > 0 && filteredRowIds.length < allRowIds.length) {
        setTargetScope('filtered');
      } else {
        setTargetScope('all');
      }
      // Set default column
      if (columns.length > 0 && !columnId) {
        const textColumn = columns.find(c => c.type === 'text' || c.type === 'select');
        setColumnId(textColumn?.id || columns[0].id);
      }
    }
  }, [open, selectedRowIds.size, filteredRowIds.length, allRowIds.length, columns]);
  
  // Build config from form state
  const config: BulkReplaceConfig = useMemo(() => ({
    targetScope,
    columnId,
    operationType,
    findValue: operationType === 'replace' ? findValue : undefined,
    replaceValue: operationType === 'replace' ? replaceValue : undefined,
    prependValue: operationType === 'addText' ? prependValue : undefined,
    appendValue: operationType === 'addText' ? appendValue : undefined,
    formula: operationType === 'formula' ? formulaValue : undefined,
    caseSensitive,
    useRegex
  }), [targetScope, columnId, operationType, findValue, replaceValue, prependValue, appendValue, formulaValue, caseSensitive, useRegex]);
  
  // Calculate preview
  const { preview, totalChanges } = useMemo(() => {
    if (!columnId || !open) return { preview: [], totalChanges: 0 };
    
    // Skip preview for clear operation without find value
    if (operationType === 'clear') {
      const targetIds = getTargetRowIds(targetScope, {
        selected: selectedRowIds,
        filtered: filteredRowIds,
        all: allRowIds
      });
      return { preview: [], totalChanges: targetIds.size };
    }
    
    // Skip preview if no find value for replace
    if (operationType === 'replace' && !findValue) {
      return { preview: [], totalChanges: 0 };
    }
    
    const targetIds = getTargetRowIds(targetScope, {
      selected: selectedRowIds,
      filtered: filteredRowIds,
      all: allRowIds
    });
    
    return generateReplacePreview(config, rows, columns, targetIds, 10);
  }, [config, rows, columns, targetScope, selectedRowIds, filteredRowIds, allRowIds, open, columnId, operationType, findValue]);
  
  // Get counts for scope options
  const scopeCounts = useMemo(() => ({
    selected: selectedRowIds.size,
    filtered: filteredRowIds.length,
    all: allRowIds.length
  }), [selectedRowIds.size, filteredRowIds.length, allRowIds.length]);
  
  // Filterable columns (exclude readonly, button, etc)
  const editableColumns = useMemo(() => {
    return columns.filter(col => 
      !col.isReadonly && 
      !['button', 'table', 'relation', 'rollup', 'formula'].includes(col.type)
    );
  }, [columns]);
  
  // Handle replace
  const handleReplace = useCallback(async () => {
    if (!columnId) {
      setError(t('bulkReplace.errSelectColumn'));
      return;
    }

    if (operationType === 'replace' && !findValue) {
      setError(t('bulkReplace.errFindText'));
      return;
    }

    if (operationType === 'formula' && !formulaValue) {
      setError(t('bulkReplace.errFormula'));
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const res = await onReplace(config);
      setResult(res);
      
      if (res.success && res.totalChanged > 0) {
        // Close modal after short delay on success
        setTimeout(() => {
          onOpenChange(false);
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bulkReplace.errGeneric'));
    } finally {
      setIsProcessing(false);
    }
  }, [config, columnId, operationType, findValue, formulaValue, onReplace, onOpenChange]);
  
  // Get rows for preview based on scope
  const previewRows = useMemo(() => {
    if (rows.length === 0) return [];
    
    if (targetScope === 'selected' && selectedRowIds.size > 0) {
      return rows.filter(r => selectedRowIds.has(r.id));
    }
    if (targetScope === 'filtered' && filteredRowIds.length > 0) {
      const filteredSet = new Set(filteredRowIds);
      return rows.filter(r => filteredSet.has(r.id));
    }
    return rows;
  }, [rows, targetScope, selectedRowIds, filteredRowIds]);
  
  // Current preview row with bounds check
  const currentPreviewRow = useMemo(() => {
    if (previewRows.length === 0) return null;
    const safeIndex = Math.max(0, Math.min(previewRowIndex, previewRows.length - 1));
    return previewRows[safeIndex]?.data || null;
  }, [previewRows, previewRowIndex]);
  
  // Navigation handlers
  const goToPrevRow = useCallback(() => {
    setPreviewRowIndex(prev => Math.max(0, prev - 1));
  }, []);
  
  const goToNextRow = useCallback(() => {
    setPreviewRowIndex(prev => Math.min(previewRows.length - 1, prev + 1));
  }, [previewRows.length]);
  
  // Reset preview index when scope changes
  useEffect(() => {
    setPreviewRowIndex(0);
  }, [targetScope]);
  
  // Insert variable into formula
  const insertVariable = useCallback((variable: string) => {
    setFormulaValue(prev => prev + variable);
  }, []);
  
  if (!open) return null;
  
  // Footer with action buttons
  const modalFooter = (
    <div className="flex items-center gap-3 w-full justify-end">
      <Button
        variant="secondary"
        onClick={() => onOpenChange(false)}
        disabled={isProcessing}
      >
        {t('bulkReplace.cancel')}
      </Button>
      <Button
        variant="primary"
        onClick={handleReplace}
        disabled={isProcessing || totalChanges === 0}
        data-testid="replace-all-button"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {t('bulkReplace.processing')}
          </>
        ) : (
          <>
            <Replace className="w-4 h-4 mr-2" />
            {t('bulkReplace.replaceAll')} ({totalChanges})
          </>
        )}
      </Button>
    </div>
  );
  
  return (
    <Modal
      open={open}
      onOpenChange={(val) => !isProcessing && onOpenChange(val)}
      title={t('bulkReplace.title')}
      size="lg"
      fixedHeight
      heightOffset={200}
      footer={modalFooter}
    >
      <div className="flex flex-col gap-4 h-full">
        {/* Scope selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              {t('bulkReplace.applyTo')}
            </label>
            <div className="space-y-2">
              {[
                { value: 'selected', label: t('bulkReplace.scopeSelected'), count: scopeCounts.selected },
                { value: 'filtered', label: t('bulkReplace.scopeFiltered'), count: scopeCounts.filtered },
                { value: 'all', label: t('bulkReplace.scopeAll'), count: scopeCounts.all },
              ].map(option => (
                <label 
                  key={option.value} 
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition",
                    targetScope === option.value 
                      ? "bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]/30"
                      : "hover:bg-[var(--bg-tertiary)] border border-transparent",
                    option.count === 0 && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={option.value}
                    checked={targetScope === option.value}
                    onChange={() => option.count > 0 && setTargetScope(option.value as BulkReplaceConfig['targetScope'])}
                    disabled={option.count === 0}
                    className="w-4 h-4 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {option.label}
                  </span>
                  <span className={cn(
                    "ml-auto px-2 py-0.5 rounded-full text-xs font-medium",
                    targetScope === option.value
                      ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                  )}>
                    {option.count}
                  </span>
                </label>
              ))}
            </div>
          </div>
          
          <hr className="border-[var(--border-primary)]" />
          
          {/* Column selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              {t('bulkReplace.columnLabel')}
            </label>
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className={cn(
                "w-full px-4 py-2.5 rounded-lg",
                "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                "text-[var(--text-primary)] text-sm",
                "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              )}
              data-testid="column-select"
            >
              {editableColumns.map(col => (
                <option key={col.id} value={col.id}>
                  {col.displayName || col.name} | {col.name} ({col.type})
                </option>
              ))}
            </select>
          </div>
          
          {/* Operation type */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              {t('bulkReplace.operationType')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'replace', label: t('bulkReplace.opReplace') },
                { value: 'addText', label: t('bulkReplace.opAppend') },
                { value: 'formula', label: t('bulkReplace.opFormula') },
                { value: 'clear', label: t('bulkReplace.opClear') },
              ].map(option => (
                <label 
                  key={option.value} 
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-lg cursor-pointer transition border",
                    operationType === option.value 
                      ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                      : "hover:bg-[var(--bg-tertiary)] border-transparent"
                  )}
                >
                  <input
                    type="radio"
                    name="operation"
                    value={option.value}
                    checked={operationType === option.value}
                    onChange={() => setOperationType(option.value as BulkReplaceOperationType)}
                    className="w-4 h-4 text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          
          <hr className="border-[var(--border-primary)]" />
          
          {/* Replace form */}
          {operationType === 'replace' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('bulkReplace.findLabel')}
                </label>
                <input
                  type="text"
                  value={findValue}
                  onChange={(e) => setFindValue(e.target.value)}
                  placeholder={t('bulkReplace.findPlaceholder')}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-lg",
                    "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)] text-sm placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
                  )}
                  data-testid="find-input"
                />
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={caseSensitive}
                      onChange={(e) => setCaseSensitive(e.target.checked)}
                      className="w-4 h-4 rounded text-[var(--color-primary-500)]"
                    />
                    {t('bulkReplace.caseSensitive')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useRegex}
                      onChange={(e) => setUseRegex(e.target.checked)}
                      className="w-4 h-4 rounded text-[var(--color-primary-500)]"
                    />
                    {t('bulkReplace.regex')}
                  </label>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('bulkReplace.replaceWithLabel')}
                </label>
                <input
                  type="text"
                  value={replaceValue}
                  onChange={(e) => setReplaceValue(e.target.value)}
                  placeholder={t('bulkReplace.replaceWithPlaceholder')}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-lg",
                    "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)] text-sm placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
                  )}
                  data-testid="replace-input"
                />
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {t('bulkReplace.columnTemplateHint').split('{{column}}').map((part, idx, arr) => (
                    <span key={idx}>
                      {part}
                      {idx < arr.length - 1 && <code className="text-orange-500">{`{{column}}`}</code>}
                    </span>
                  ))}
                </p>
              </div>

              {/* Column mapping for replace */}
              <BulkReplaceColumnMap
                columns={columns}
                currentPreviewRow={currentPreviewRow}
                previewRowIndex={previewRowIndex}
                previewRowsLength={previewRows.length}
                onPrevRow={goToPrevRow}
                onNextRow={goToNextRow}
                tableInfo={tableInfo}
              />
            </div>
          )}

          {/* Add Text form (prefix + suffix) */}
          {operationType === 'addText' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('bulkReplace.prependLabel')}
                </label>
                <input
                  type="text"
                  value={prependValue}
                  onChange={(e) => setPrependValue(e.target.value)}
                  placeholder={t('bulkReplace.prependPlaceholder')}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-lg",
                    "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)] text-sm placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
                  )}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('bulkReplace.appendLabel')}
                </label>
                <input
                  type="text"
                  value={appendValue}
                  onChange={(e) => setAppendValue(e.target.value)}
                  placeholder={t('bulkReplace.appendPlaceholder')}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-lg",
                    "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)] text-sm placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
                  )}
                />
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">
                {t('bulkReplace.columnTemplateHint').split('{{column}}').map((part, idx, arr) => (
                  <span key={idx}>
                    {part}
                    {idx < arr.length - 1 && <code className="text-orange-500">{`{{column}}`}</code>}
                  </span>
                ))}
              </p>

              {/* Column mapping for addText */}
              <BulkReplaceColumnMap
                columns={columns}
                currentPreviewRow={currentPreviewRow}
                previewRowIndex={previewRowIndex}
                previewRowsLength={previewRows.length}
                onPrevRow={goToPrevRow}
                onNextRow={goToNextRow}
                tableInfo={tableInfo}
              />
            </div>
          )}

          {/* Formula form */}
          {operationType === 'formula' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('bulkReplace.formulaLabel')}
                </label>
                <textarea
                  value={formulaValue}
                  onChange={(e) => setFormulaValue(e.target.value)}
                  placeholder={t('bulkReplace.formulaPlaceholder')}
                  rows={3}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-lg font-mono text-sm",
                    "bg-[var(--bg-primary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent",
                    "resize-none"
                  )}
                  data-testid="formula-input"
                />
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {(() => {
                    const hint = t('bulkReplace.formulaHint');
                    const re = /\{\{(value|column)\}\}/g;
                    const parts: Array<string | { token: string }> = [];
                    let last = 0;
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(hint)) !== null) {
                      if (m.index > last) parts.push(hint.slice(last, m.index));
                      parts.push({ token: m[1] });
                      last = m.index + m[0].length;
                    }
                    if (last < hint.length) parts.push(hint.slice(last));
                    return parts.map((p, i) =>
                      typeof p === 'string'
                        ? <span key={i}>{p}</span>
                        : <code key={i} className="text-orange-500">{`{{${p.token}}}`}</code>
                    );
                  })()}
                </p>
              </div>
              
              {/* Column mapping */}
              <BulkReplaceColumnMap
                columns={columns}
                currentPreviewRow={currentPreviewRow}
                previewRowIndex={previewRowIndex}
                previewRowsLength={previewRows.length}
                onPrevRow={goToPrevRow}
                onNextRow={goToNextRow}
                onInsertVariable={insertVariable}
                showSpecialVariables
                tableInfo={tableInfo}
              />
            </div>
          )}
          
          {/* Clear confirmation */}
          {operationType === 'clear' && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {t('bulkReplace.warning')}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    {t('bulkReplace.clearWarning')}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Preview */}
          {(totalChanges > 0 || preview.length > 0) && (
            <div>
              <button
                type="button"
                onClick={() => setPreviewExpanded(!previewExpanded)}
                className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] mb-2 hover:text-[var(--text-primary)] transition-colors"
              >
                {previewExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {t('bulkReplace.preview')} ({totalChanges})
              </button>
              
              {previewExpanded ? (
              <div className={cn(
                "max-h-48 overflow-auto rounded-lg",
                "bg-[var(--bg-primary)] border border-[var(--border-primary)]"
              )}>
                {preview.length > 0 ? (
                  <div className="divide-y divide-[var(--border-primary)]">
                    {preview.map((item) => (
                      <div key={String(item.rowId)} className="px-4 py-2 text-sm">
                        <span className="text-[var(--text-tertiary)]">
                          {t('bulkReplace.previewRowPrefix').replace('{index}', String(item.rowIndex))}
                        </span>
                        <span className="ml-2 text-red-500 line-through">
                          "{String(item.currentValue || '')}"
                        </span>
                        <span className="mx-2 text-[var(--text-tertiary)]">→</span>
                        <span className="text-green-500">
                          "{String(item.newValue || '')}"
                        </span>
                      </div>
                    ))}
                    {totalChanges > preview.length && (
                      <div className="px-4 py-2 text-sm text-[var(--text-tertiary)]">
                        {t('bulkReplace.andMore').replace('{count}', String(totalChanges - preview.length))}
                      </div>
                    )}
                  </div>
                ) : operationType === 'clear' ? (
                  <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    {t('bulkReplace.clearWillRemove').replace('{count}', String(totalChanges))}
                  </div>
                ) : null}
                <div className="px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {t('bulkReplace.totalChanges').replace('{count}', String(totalChanges))}
                  </span>
                </div>
              </div>
              ) : (
                <div className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm text-[var(--text-secondary)]">
                  {t('bulkReplace.totalChanges').replace('{count}', String(totalChanges))}
                </div>
              )}
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 text-red-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}
          
          {/* Success message */}
          {result?.success && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">
                  {t('bulkReplace.successChanged').replace('{changed}', String(result.totalChanged)).replace('{total}', String(result.totalProcessed))}
                </span>
              </div>
            </div>
          )}
        </div>
    </Modal>
  );
};
