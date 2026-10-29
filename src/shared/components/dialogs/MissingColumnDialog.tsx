/**
 * MissingColumnDialog Component
 * ADR-031: Missing Column Resolution Dialog
 * 
 * UI component for resolving missing column errors
 * Uses Modal component from shared/components/ui
 */
import { useState, useMemo, useCallback } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Select } from '@/shared/components/ui/Select';
import { Checkbox } from '@/shared/components/ui/Checkbox';
import { cn } from '@/shared/utils/cn';
import { 
  ColumnType, 
  COLUMN_TYPE_METADATA,
  getColumnTypeOptionsWithEmoji 
} from '@/shared/types';
import {
  useMissingColumnStore,
  useIsMissingColumnDialogOpen
} from '@/shared/stores/missingColumnStore';
import {
  MissingColumnResolver,
  missingColumnResolver,
  SimilarColumn,
  SOURCE_LABELS,
  ResolutionResult
} from '@/shared/services/MissingColumnResolver';
import { isTypeCompatible, validateSampleValues, ValidationResult } from '@/shared/utils/columnCompatibility';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * Action type for resolution
 */
type ActionType = 'create' | 'map' | 'skip';

/**
 * Radio button option component
 */
interface RadioOptionProps {
  value: ActionType;
  selected: boolean;
  onSelect: (value: ActionType) => void;
  title: string;
  icon: string;
  children?: React.ReactNode;
}

const RadioOption = ({ value, selected, onSelect, title, icon, children }: RadioOptionProps) => (
  <div
    className={cn(
      "p-3 rounded-lg border cursor-pointer transition-colors",
      selected
        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/5"
        : "border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
    )}
    onClick={() => onSelect(value)}
    role="radio"
    aria-checked={selected}
    tabIndex={0}
    onKeyDown={(e) => e.key === 'Enter' && onSelect(value)}
  >
    <div className="flex items-center gap-3">
      <div className={cn(
        "w-4 h-4 rounded-full border-2 flex items-center justify-center",
        selected 
          ? "border-[var(--accent-primary)]" 
          : "border-[var(--border-primary)]"
      )}>
        {selected && (
          <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />
        )}
      </div>
      <span className="mr-1">{icon}</span>
      <span className="font-medium text-[var(--text-primary)]">{title}</span>
    </div>
    {selected && children && (
      <div className="mt-3 ml-7 space-y-2">
        {children}
      </div>
    )}
  </div>
);

/**
 * Validation badge component
 */
const ValidationBadge = ({ result }: { result: ValidationResult }) => {
  if (!result.error && !result.warning) return null;
  
  if (result.error) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 px-2 py-1 rounded">
        <span>⚠️</span>
        <span>{result.error}</span>
      </div>
    );
  }
  
  if (result.warning) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-warning)] bg-[var(--color-warning)]/10 px-2 py-1 rounded">
        <span>⚡</span>
        <span>{result.warning}</span>
      </div>
    );
  }
  
  return null;
};

/**
 * MissingColumnDialog - Main component
 */
export const MissingColumnDialog = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const isOpen = useIsMissingColumnDialogOpen();
  const { 
    context, 
    contexts,
    tableColumns, 
    resolve, 
    closeDialog 
  } = useMissingColumnStore();
  
  const [action, setAction] = useState<ActionType>('create');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [newColumnType, setNewColumnType] = useState<ColumnType>('text');
  const [applyToAll, setApplyToAll] = useState(false);
  
  // Reset state when context changes
  useMemo(() => {
    if (context) {
      setAction('create');
      setSelectedColumn('');
      setApplyToAll(false);
      
      // Detect type from sample values
      const detectedType = context.expectedType || 
        missingColumnResolver.detectColumnType(context.sampleValues || []);
      setNewColumnType(detectedType);
    }
  }, [context]);
  
  // Find similar columns
  const similarColumns = useMemo(() => {
    if (!context) return [];
    return missingColumnResolver.findSimilarColumns(
      tableColumns,
      context.missingColumnKey,
      context.expectedType
    );
  }, [context, tableColumns]);
  
  // Get column type options
  const columnTypeOptions = useMemo(() => {
    return getColumnTypeOptionsWithEmoji().map(opt => ({
      value: opt.value,
      label: `${opt.emoji} ${opt.label}`,
      description: opt.description
    }));
  }, []);
  
  // Column options for select
  const columnOptions = useMemo(() => {
    return tableColumns.map(col => {
      const similar = similarColumns.find(s => s.column.id === col.id);
      const meta = COLUMN_TYPE_METADATA[col.type];
      return {
        value: col.id,
        label: `${meta?.emoji || '📋'} ${col.name}`,
        description: similar?.reasons.join(', ')
      };
    });
  }, [tableColumns, similarColumns]);
  
  // Validate selected mapping
  const mappingValidation = useMemo((): ValidationResult => {
    if (action !== 'map' || !selectedColumn || !context) {
      return { valid: true };
    }
    
    const column = tableColumns.find(c => c.id === selectedColumn);
    if (!column) return { valid: false, error: t('Колонка не найдена', 'Column not found') };

    // Type compatibility check
    if (context.expectedType && !isTypeCompatible(column.type, context.expectedType)) {
      return {
        valid: false,
        error: t(
          `Тип "${COLUMN_TYPE_METADATA[column.type]?.label}" несовместим с ожидаемым "${COLUMN_TYPE_METADATA[context.expectedType]?.label}"`,
          `Type "${COLUMN_TYPE_METADATA[column.type]?.label}" is incompatible with the expected "${COLUMN_TYPE_METADATA[context.expectedType]?.label}"`
        )
      };
    }
    
    // Sample values check
    if (context.sampleValues?.length) {
      return validateSampleValues(context.sampleValues, column.type);
    }
    
    return { valid: true };
  }, [action, selectedColumn, context, tableColumns]);
  
  // Handle apply
  const handleApply = useCallback(() => {
    if (!context) return;
    
    const result: ResolutionResult = { action, applyToAll };
    
    if (action === 'create') {
      result.newColumn = {
        name: context.missingColumnKey,
        type: newColumnType
      };
    } else if (action === 'map' && selectedColumn) {
      const column = tableColumns.find(c => c.id === selectedColumn);
      result.mappedColumnId = selectedColumn;
      result.mappedColumnName = column?.name;
    }
    
    resolve(result);
  }, [context, action, applyToAll, newColumnType, selectedColumn, tableColumns, resolve]);
  
  // Can apply?
  const canApply = useMemo(() => {
    if (action === 'create') return true;
    if (action === 'map') return !!selectedColumn && mappingValidation.valid;
    if (action === 'skip') return true;
    return false;
  }, [action, selectedColumn, mappingValidation]);
  
  // Handle batch mode
  const isBatchMode = contexts.length > 0 && !context;
  
  if (!isOpen || (!context && !isBatchMode)) return null;
  
  // Batch mode handled by separate component
  if (isBatchMode) {
    return <MissingColumnBatchDialog />;
  }
  
  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && closeDialog()}
      title={t('Колонка не найдена', 'Column not found')}
      size="md"
    >
      <div className="space-y-4">
        {/* Error info */}
        <div className="p-3 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="text-sm text-[var(--text-primary)]">
                {t('Колонка', 'Column')} <code className="font-mono bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-[var(--accent-primary)]">
                  {context?.missingColumnKey}
                </code> {t('не найдена в таблице', 'not found in table')} &quot;{context?.tableName}&quot;
              </p>
              {context?.source && (
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {t('Источник:', 'Source:')} {SOURCE_LABELS[context.source]}
                </p>
              )}
            </div>
          </div>
        </div>
        
        {/* Action selection */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            {t('Выберите действие:', 'Choose an action:')}
          </p>
          
          {/* Create new column */}
          <RadioOption
            value="create"
            selected={action === 'create'}
            onSelect={setAction}
            title={t(`Создать колонку "${context?.missingColumnKey}"`, `Create column "${context?.missingColumnKey}"`)}
            icon="➕"
          >
            <Select
              label={t('Тип колонки', 'Column type')}
              value={newColumnType}
              onChange={(val) => setNewColumnType(val as ColumnType)}
              options={columnTypeOptions}
            />
            {context?.sampleValues && context.sampleValues.length > 0 && (
              <p className="text-xs text-[var(--text-tertiary)]">
                💡 {t('Тип определён по данным:', 'Type detected from data:')} {COLUMN_TYPE_METADATA[newColumnType]?.emoji} {COLUMN_TYPE_METADATA[newColumnType]?.label}
              </p>
            )}
          </RadioOption>
          
          {/* Map to existing */}
          <RadioOption
            value="map"
            selected={action === 'map'}
            onSelect={setAction}
            title={t('Использовать существующую колонку', 'Use an existing column')}
            icon="🔗"
          >
            <Select
              placeholder={t('Выберите колонку...', 'Select a column...')}
              value={selectedColumn}
              onChange={setSelectedColumn}
              options={columnOptions}
            />
            
            {/* Validation */}
            {selectedColumn && <ValidationBadge result={mappingValidation} />}
            
            {/* Similar columns hint */}
            {!selectedColumn && similarColumns.length > 0 && (
              <div className="text-xs text-[var(--text-tertiary)]">
                💡 {t('Похожие:', 'Similar:')} {similarColumns.slice(0, 3).map(s =>
                  `${s.column.name} (${Math.round(s.score * 100)}%)`
                ).join(', ')}
              </div>
            )}
          </RadioOption>
          
          {/* Skip */}
          <RadioOption
            value="skip"
            selected={action === 'skip'}
            onSelect={setAction}
            title={t('Пропустить эту колонку', 'Skip this column')}
            icon="⏭️"
          />
        </div>
        
        {/* Apply to all checkbox */}
        <div className="pt-2 border-t border-[var(--border-secondary)]">
          <Checkbox
            checked={applyToAll}
            onCheckedChange={(checked) => setApplyToAll(!!checked)}
            label={t('Применить ко всем похожим ошибкам', 'Apply to all similar errors')}
            description={t('Это решение будет использоваться автоматически для аналогичных случаев', 'This resolution will be applied automatically to similar cases')}
          />
        </div>
      </div>
      
      {/* Footer */}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={closeDialog}>
          {t('Отмена', 'Cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleApply}
          disabled={!canApply}
        >
          {t('Применить', 'Apply')}
        </Button>
      </div>
    </Modal>
  );
};

/**
 * Batch mode dialog - for handling multiple missing columns
 * (e.g., during CSV import)
 */
const MissingColumnBatchDialog = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const { contexts, tableColumns, resolveBatch, closeDialog } = useMissingColumnStore();
  const [results, setResults] = useState<Record<number, ResolutionResult>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const currentContext = contexts[currentIndex];
  
  const handleResolve = (result: ResolutionResult) => {
    const newResults = { ...results, [currentIndex]: result };
    setResults(newResults);
    
    // Apply to all if checked
    if (result.applyToAll) {
      const key = currentContext.missingColumnKey;
      contexts.forEach((ctx, idx) => {
        if (idx > currentIndex && ctx.missingColumnKey === key) {
          newResults[idx] = result;
        }
      });
      setResults(newResults);
    }
    
    // Move to next unresolved
    const nextUnresolved = contexts.findIndex((_, idx) => idx > currentIndex && !newResults[idx]);
    if (nextUnresolved !== -1) {
      setCurrentIndex(nextUnresolved);
    } else {
      // All resolved, submit
      const finalResults = contexts.map((_, idx) => 
        newResults[idx] || { action: 'skip' as const }
      );
      resolveBatch(finalResults);
    }
  };
  
  const resolvedCount = Object.keys(results).length;
  const progress = Math.round((resolvedCount / contexts.length) * 100);
  
  return (
    <Modal
      open={true}
      onOpenChange={(open) => !open && closeDialog()}
      title={t(`Отсутствующие колонки (${currentIndex + 1}/${contexts.length})`, `Missing columns (${currentIndex + 1}/${contexts.length})`)}
      size="md"
    >
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
            <span>{t('Прогресс', 'Progress')}</span>
            <span>{resolvedCount}/{contexts.length}</span>
          </div>
          <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--accent-primary)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        {/* Current column info */}
        {currentContext && (
          <div className="p-3 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 rounded-lg">
            <p className="text-sm">
              {t('Колонка', 'Column')} <code className="font-mono bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-[var(--accent-primary)]">
                {currentContext.missingColumnKey}
              </code>
            </p>
            {currentContext.sampleValues && currentContext.sampleValues.length > 0 && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                {t('Примеры данных:', 'Sample data:')} {currentContext.sampleValues.slice(0, 3).map(v => String(v)).join(', ')}
              </p>
            )}
          </div>
        )}
        
        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => handleResolve({
              action: 'create',
              newColumn: {
                name: currentContext.missingColumnKey,
                type: missingColumnResolver.detectColumnType(currentContext.sampleValues || [])
              }
            })}
          >
            ➕ {t('Создать', 'Create')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleResolve({ action: 'skip' })}
          >
            ⏭️ {t('Пропустить', 'Skip')}
          </Button>
        </div>
        
        {/* Similar columns for quick mapping */}
        {(() => {
          const similar = missingColumnResolver.findSimilarColumns(
            tableColumns,
            currentContext.missingColumnKey,
            currentContext.expectedType
          ).slice(0, 3);
          
          if (similar.length === 0) return null;
          
          return (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-tertiary)]">
                {t('Похожие колонки:', 'Similar columns:')}
              </p>
              {similar.map((s) => (
                <button
                  key={s.column.id}
                  onClick={() => handleResolve({
                    action: 'map',
                    mappedColumnId: s.column.id,
                    mappedColumnName: s.column.name
                  })}
                  className="w-full p-2 text-left text-sm rounded border border-[var(--border-primary)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/5 transition-colors"
                >
                  <span className="font-medium">🔗 {s.column.name}</span>
                  <span className="text-xs text-[var(--text-tertiary)] ml-2">
                    ({Math.round(s.score * 100)}% — {s.reasons.join(', ')})
                  </span>
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      
      {/* Footer */}
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={closeDialog}>
          {t('Отменить всё', 'Cancel all')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            // Skip all remaining
            const finalResults = contexts.map((_, idx) => 
              results[idx] || { action: 'skip' as const }
            );
            resolveBatch(finalResults);
          }}
        >
          {t('Пропустить остальные', 'Skip the rest')}
        </Button>
      </div>
    </Modal>
  );
};

export default MissingColumnDialog;
