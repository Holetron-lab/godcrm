import { ReactNode } from 'react';
import { ColumnModel } from '../types/table.types';

interface ReadOnlyCellProps {
  value: unknown;
  column: ColumnModel;
  children?: ReactNode;
  className?: string;
}

export function ReadOnlyCell({ value, column, children, className = '' }: ReadOnlyCellProps) {
  const isReadOnly = column.is_locked || column.is_from_source || column.isReadonly;

  if (!isReadOnly) {
    return <>{children}</>;
  }

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <div
      className={`
        px-3 py-2 
        bg-gray-50 dark:bg-gray-900/50 
        text-gray-700 dark:text-gray-400
        rounded
        cursor-not-allowed
        select-none
        ${className}
      `}
      title="This field is read-only (from external source)"
    >
      {children || formatValue(value)}
    </div>
  );
}
