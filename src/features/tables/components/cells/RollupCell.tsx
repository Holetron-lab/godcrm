import React from 'react';

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
  rawMode?: boolean;
}

// Replace {{variable}} placeholders and evaluate formula
const EMPTY_MARKER = '__EMPTY__';

const evaluateFormula = (formula: string, rowData: Record<string, unknown>): string => {
  if (!formula) return EMPTY_MARKER;
  
  let hasEmptyValue = false;
  
  // Replace {{column_key}} with actual values
  let processed = formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
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
    if (/[\+\-\*\/\(\)]/.test(processed)) {
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
  rawMode = false,
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
      const formulaValue = evaluateFormula(field.formula, rowData);
      const prefix = field.prefix || '';
      const suffix = field.suffix || '';
      
      // Если значения нет (пустое), показываем прочерк. Ноль показываем как есть.
      const isEmpty = formulaValue === EMPTY_MARKER || formulaValue === '' || formulaValue === null || formulaValue === undefined;
      const fullValue = isEmpty ? '—' : `${prefix}${formulaValue}${suffix}`;
      
      return { 
        label, 
        value: fullValue,
        hasValue: !isEmpty
      };
    });

  if (displayItems.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {displayItems.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-tertiary)] truncate max-w-[80px]">{item.label}:</span>
          <span className={`font-medium ${item.hasValue ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
            {item.value || '—'}
          </span>
        </div>
      ))}
    </div>
  );
};
