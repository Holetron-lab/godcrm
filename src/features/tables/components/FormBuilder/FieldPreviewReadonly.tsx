import React, { useId } from 'react';
import type { FormField } from '../../types/form-config.types';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import { useRelationOptions } from '../../hooks/useRelationOptions';
import type { ViewMode } from './types';

// Wrapper for relation fields to load options
export function RelationFieldWrapper({
  field,
  column,
  viewMode,
  sampleValue,
}: {
  field: FormField;
  column: ColumnModel | undefined;
  viewMode: ViewMode;
  sampleValue?: unknown;
}) {
  // Load relation options if this is a relation field
  const { options: relationOptions } = useRelationOptions(column?.config?.relation);

  return (
    <FieldPreviewReadonly
      field={field}
      column={column}
      viewMode={viewMode}
      sampleValue={sampleValue}
      relationOptions={relationOptions}
    />
  );
}

// Field preview for preview mode (read-only, no selection)
export function FieldPreviewReadonly({
  field,
  column,
  viewMode,
  sampleValue,
  relationOptions,
}: {
  field: FormField;
  column: ColumnModel | undefined;
  viewMode: ViewMode;
  sampleValue?: unknown;
  relationOptions?: ColumnOption[];
}) {
  const inputId = useId();
  if (!column) return null;

  const displayName = field.label || column.displayName || column.name;

  // Width calculation
  const widthStyle = { width: { quarter: '25%', third: '33.333%', half: '50%', full: '100%', auto: '100%' }[field.width] };

  // Get options - either from column config or from relation
  const options = relationOptions?.length ? relationOptions : (column.config?.options || []);

  // Find label for current value (for select/relation)
  const getDisplayValue = (val: unknown): string => {
    if (val === null || val === undefined || val === '') return '';
    const strVal = String(val);
    const opt = options.find((o: ColumnOption) => String(o.value) === strVal);
    return opt?.label || strVal;
  };

  // Render input based on column type
  const renderInput = (compact = false) => {
    const baseInputClass = "w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] border-[var(--border-primary)]";
    const placeholder = compact ? displayName : (field.placeholder || displayName);

    switch (column.type) {
      case 'checkbox':
        return (
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-primary)] truncate">
              {displayName}
            </label>
            <input id={inputId} aria-label={displayName}
              className="w-5 h-5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)] flex-shrink-0"
              type="checkbox"
              checked={Boolean(sampleValue)}
              onChange={() => {}}
            />
          </div>
        );

      case 'select':
      case 'multi-select':
        return (
          <select id={inputId} aria-label={displayName}
            className={baseInputClass}
            defaultValue={sampleValue as string || ''}
          >
            <option value="">{compact ? displayName : 'Выберите...'}</option>
            {options.map((opt: ColumnOption) => (
              <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
            ))}
          </select>
        );

      case 'relation':
        // For relation - show select with loaded options
        return (
          <select id={inputId} aria-label={displayName}
            className={baseInputClass}
            defaultValue={sampleValue as string || ''}
          >
            <option value="">{compact ? displayName : 'Выберите...'}</option>
            {options.map((opt: ColumnOption) => (
              <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
            ))}
          </select>
        );

      case 'datetime': {
        // Format date properly for input[type="date"]
        const formatDate = (val: unknown): string => {
          if (!val) return '';
          const str = String(val);
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
          if (str.includes('T')) return str.split('T')[0];
          const d = new Date(str);
          return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
        };
        // If no time component needed, show date input
        const strVal = sampleValue ? String(sampleValue) : '';
        if (!strVal.includes('T') || strVal.endsWith('T00:00:00') || strVal.endsWith('T00:00')) {
          return (
            <input id={inputId} aria-label={displayName}
              type="date"
              className={baseInputClass}
              defaultValue={formatDate(sampleValue)}
            />
          );
        }
        // Format datetime properly for input[type="datetime-local"]
        const formatDateTime = (val: unknown): string => {
          if (!val) return '';
          const str = String(val);
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;
          if (str.includes('T')) return str.slice(0, 16);
          const d = new Date(str);
          return !isNaN(d.getTime()) ? d.toISOString().slice(0, 16) : '';
        };
        return (
          <input id={inputId} aria-label={displayName}
            type="datetime-local"
            className={baseInputClass}
            defaultValue={formatDateTime(sampleValue)}
          />
        );
      }

      case 'number':
        return (
          <input id={inputId} aria-label={displayName}
            type="number"
            className={baseInputClass}
            placeholder={placeholder}
            defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
          />
        );

      case 'email':
        return (
          <input id={inputId} aria-label={displayName}
            type="email"
            className={baseInputClass}
            placeholder={placeholder}
            defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
          />
        );

      case 'url':
        return (
          <input id={inputId} aria-label={displayName}
            type="url"
            className={baseInputClass}
            placeholder={compact ? displayName : 'https://...'}
            defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
          />
        );

      case 'phone':
        return (
          <input id={inputId} aria-label={displayName}
            type="tel"
            className={baseInputClass}
            placeholder={compact ? displayName : '+7 (999) 123-45-67'}
            defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
          />
        );

      // Note: 'textarea' is not a ColumnType - text fields with rows > 1 are handled via FormField config
      // Keeping textarea-like rendering under 'text' default case

      case 'password':
        return (
          <input id={inputId} aria-label={displayName}
            type="password"
            className={baseInputClass}
            placeholder="••••••••"
            defaultValue=""
          />
        );

      case 'text':
      default:
        if (field.expandable) {
          return (
            <textarea id={inputId} aria-label={displayName}
              className={`${baseInputClass} resize-y`}
              placeholder={placeholder}
              rows={field.rows && field.rows > 0 ? field.rows : 3}
              defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
            />
          );
        }
        return (
          <input id={inputId} aria-label={displayName}
            type="text"
            className={baseInputClass}
            placeholder={placeholder}
            defaultValue={sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : ''}
          />
        );
    }
  };

  // Checkbox - special rendering
  if (column.type === 'checkbox') {
    return (
      <div className="p-1.5" style={widthStyle}>
        <div className="px-3 py-2">
          {renderInput()}
        </div>
      </div>
    );
  }

  // Compact mode - label as placeholder
  if (viewMode === 'compact') {
    return (
      <div className="p-1.5" style={widthStyle}>
        <div className="py-1">
          {renderInput(true)}
        </div>
      </div>
    );
  }

  // Regular field rendering
  return (
    <div className="p-1.5" style={widthStyle}>
      <div>
        {/* Label */}
        <div className="px-3 pt-1 pb-1">
          <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-primary)]">
            {displayName}
          </label>
        </div>

        {/* Input */}
        <div className="px-3 pb-1">
          {renderInput()}
        </div>
      </div>
    </div>
  );
}
