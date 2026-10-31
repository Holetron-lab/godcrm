import React from 'react';
import type { ColumnConfig } from '../../types/table.types';
import { DateCell } from './DateCell';

interface RollupField {
  id: string;
  label: string;
  formula: string;
  prefix?: string;
  suffix?: string;
}

interface RollupConfig {
  fields?: RollupField[];
}

interface RollupCellProps {
  value: unknown;
  config?: {
    rollup?: RollupConfig;
  };
  rowData?: Record<string, unknown>;
  columns?: { name: string; type: string; config?: ColumnConfig }[];
  rawMode?: boolean;
  canEditSource?: (sourceKey: string) => boolean;
  onSourceEdit?: (sourceKey: string, source: HTMLButtonElement) => void;
}

// Replace {{variable}} placeholders and evaluate formula
const EMPTY_MARKER = '__EMPTY__';

const evaluateFormula = (formula: string, rowData: Record<string, unknown>): string => {
  if (!formula) return EMPTY_MARKER;
  
  let hasEmptyValue = false;
  
  // Replace {{column_key}} with actual values
  const processed = formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '0';
    }
    const columnValue = rowData[key];
    if (columnValue === null || columnValue === undefined || columnValue === '') {
      hasEmptyValue = true;
      return '0'; // Для математических вычислений используем 0
    }
    return String(columnValue);
  });

  // Если формула только из одной переменной и она пустая - вернуть маркер
  if (hasEmptyValue && /^\{\{\w+\}\}$/.test(formula.trim())) {
    return EMPTY_MARKER;
  }

  // Try to evaluate as math expression
  try {
    // Check if it contains math operators
    if (/[+\-*/()]/.test(processed)) {
      // Safe eval for simple math expressions only
      const result = Function(`'use strict'; return (${processed})`)();
      return String(result);
    }
  } catch (e) {
    // If evaluation fails, return as-is
  }
  
  return processed;
};

export const RollupCell: React.FC<RollupCellProps> = ({
  value,
  config,
  rowData = {},
  columns = [],
  rawMode = false,
  canEditSource,
  onSourceEdit,
}) => {
  const rollupConfig = config?.rollup;
  
  // RAW mode
  if (rawMode) {
    if (!value || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
        {String(value)}
      </span>
    );
  }

  // If no fields configured, show empty
  if (!rollupConfig?.fields || rollupConfig.fields.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  const displayItems = rollupConfig.fields
    .map(field => {
      const label = field.label || 'Поле';
      const sourceKey = field.formula.trim().match(/^\{\{([^{}]+)\}\}$/)?.[1];
      const sourceColumn = columns.find(column => column.name === sourceKey);
      const dateColumn = sourceColumn?.type === 'date' || sourceColumn?.type === 'datetime' ? sourceColumn : undefined;
      // Direct date references use the source cell renderer, never the arithmetic evaluator.
      const formulaValue = dateColumn ? rowData[dateColumn.name] : evaluateFormula(field.formula, rowData);
      const prefix = field.prefix || '';
      const suffix = field.suffix || '';
      
      // Если значения нет (пустое), показываем прочерк. Ноль показываем как есть.
      const isEmpty = formulaValue === EMPTY_MARKER || formulaValue === '' || formulaValue === null || formulaValue === undefined;
      const fullValue = isEmpty ? '—' : dateColumn ? (
        <>
          {prefix}
          <DateCell
            value={formulaValue}
            showTime={dateColumn.type === 'datetime'}
            displayFormat={dateColumn.config?.date?.displayFormat}
            storageFormat={dateColumn.config?.date?.storageFormat}
            mode={dateColumn.config?.date?.mode}
          />
          {suffix}
        </>
      ) : `${prefix}${formulaValue}${suffix}`;
      
      return {
        label,
        value: fullValue,
        hasValue: !isEmpty,
        sourceKey,
      };
    });

  if (displayItems.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {displayItems.map((item, index) => {
        const content = <>
          <span className="text-[var(--text-secondary)] truncate max-w-[80px]">{item.label}:</span>
          <span className={`font-medium ${item.hasValue ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
            {item.value || '—'}
          </span>
        </>;
        const sourceKey = item.sourceKey;
        if (sourceKey && onSourceEdit && canEditSource?.(sourceKey)) {
          return <button
            key={index}
            type="button"
            data-rollup-source={sourceKey}
            className="flex w-full items-center gap-1.5 rounded text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text-primary)]"
            onClick={event => {
              event.stopPropagation();
              // Mouse editing stays on the cell's double-click; opening earlier closes portals on the second mousedown.
              if (event.detail === 0) onSourceEdit(sourceKey, event.currentTarget);
            }}
          >{content}</button>;
        }
        return <div key={index} data-rollup-source={item.sourceKey} className="flex items-center gap-1.5 text-xs">{content}</div>;
      })}
    </div>
  );
};
