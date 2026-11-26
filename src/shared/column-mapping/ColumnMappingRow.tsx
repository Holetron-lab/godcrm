// ADR-207 §2.5 — the reusable mapping row: source → target column / «—» / «+ new» → type.
// Extracted from the CSV import (ImportCSVModal rows 380-423) and generalised so the
// install screen (W3.3 InstallPlanTree) renders the same control under a connected table.
import { ArrowRight, AlertCircle, Check } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { isExistingTarget } from './auto-match';
import {
  NEW_COLUMN,
  type ColumnMapping,
  type ColumnMappingCompat,
  type ColumnTarget,
  type ColumnTypeOption,
  type TargetColumnLike,
} from './types';

/** Consumer overrides for the row's texts; defaults come from the `columnMapping` i18n namespace. */
export interface ColumnMappingRowLabels {
  /** Option text for `targetColumn === null`. */
  skip: string;
  /** Option text for `targetColumn === NEW_COLUMN`. */
  newColumn: string;
  /** Accessible name of the target select; `{column}` is replaced by the source column. */
  targetFor: string;
  /** Accessible name of the type select; `{column}` is replaced by the source column. */
  typeFor: string;
  /** Badge text when `compat === 'ok'`. */
  ok: string;
  /** Badge text when `compat === 'conflict'` and no reason is given. */
  conflict: string;
}

export interface ColumnMappingRowProps {
  mapping: ColumnMapping;
  targetColumns: readonly TargetColumnLike[];
  typeOptions: readonly ColumnTypeOption[];
  onTargetChange: (target: ColumnTarget) => void;
  onTypeChange: (type: string) => void;
  /** First-row sample shown under the source name. */
  sample?: string | null;
  /** Offer `+ new column`. Off for plain CSV-into-existing-table imports. */
  allowNewColumn?: boolean;
  /** Server verdict for this row (install plan). */
  compat?: ColumnMappingCompat | null;
  /** The type is not the user's to choose (install plan: the blueprint or the target column sets it). */
  lockType?: boolean;
  disabled?: boolean;
  labels?: Partial<ColumnMappingRowLabels>;
  className?: string;
}

const selectClass =
  'px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm disabled:opacity-60 disabled:cursor-not-allowed';

const fill = (template: string, column: string) => template.replace('{column}', column);

export function ColumnMappingRow({
  mapping,
  targetColumns,
  typeOptions,
  onTargetChange,
  onTypeChange,
  sample,
  allowNewColumn = false,
  compat = null,
  lockType = false,
  disabled = false,
  labels: overrides,
  className,
}: ColumnMappingRowProps) {
  const { t } = useLanguage();
  const source = mapping.sourceColumn;
  const skipLabel = overrides?.skip ?? t('columnMapping.skip');
  const newColumnLabel = overrides?.newColumn ?? t('columnMapping.newColumn');
  const targetAria = overrides?.targetFor ? fill(overrides.targetFor, source) : t('columnMapping.targetFor', { column: source });
  const typeAria = overrides?.typeFor ? fill(overrides.typeFor, source) : t('columnMapping.typeFor', { column: source });
  const okLabel = overrides?.ok ?? t('columnMapping.ok');
  const conflictLabel = overrides?.conflict ?? t('columnMapping.conflict');

  const targetValue = mapping.targetColumn === null ? '' : mapping.targetColumn;
  // An existing column's type never changes (ADR-207 §2.5 rule 3): lock the type select.
  const typeLocked = lockType || isExistingTarget(mapping.targetColumn);
  const isConflict = compat?.compat === 'conflict';
  const typeInOptions = typeOptions.some(o => o.value === mapping.type);

  return (
    <div
      role="group"
      aria-label={source}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border',
        isConflict ? 'border-red-500/40' : 'border-[var(--border-primary)]',
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{source}</div>
        <div className="text-xs text-[var(--text-secondary)] truncate">
          {sample ? sample.slice(0, 30) : t('columnMapping.noSample')}
        </div>
      </div>

      <ArrowRight className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" aria-hidden="true" />

      <select
        aria-label={targetAria}
        value={targetValue}
        disabled={disabled}
        onChange={e => onTargetChange(e.target.value === '' ? null : (e.target.value as ColumnTarget))}
        className={cn(selectClass, 'w-44')}
      >
        <option value="">{skipLabel}</option>
        {allowNewColumn && <option value={NEW_COLUMN}>{newColumnLabel}</option>}
        {targetColumns.map(c => (
          <option key={c.id} value={c.id}>
            {c.displayName || c.name}
          </option>
        ))}
      </select>

      <select
        aria-label={typeAria}
        value={mapping.type}
        disabled={disabled || typeLocked}
        onChange={e => onTypeChange(e.target.value)}
        className={cn(selectClass, 'w-36')}
      >
        {!typeInOptions && <option value={mapping.type}>{mapping.type}</option>}
        {typeOptions.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.icon ? `${opt.icon} ` : ''}{opt.label}
          </option>
        ))}
      </select>

      {compat && (
        <span
          role="status"
          className={cn(
            'flex items-center gap-1 text-xs whitespace-nowrap',
            isConflict ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-green-400',
          )}
        >
          {isConflict ? <AlertCircle className="w-4 h-4" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
          {isConflict ? compat.reason || conflictLabel : okLabel}
        </span>
      )}
    </div>
  );
}
