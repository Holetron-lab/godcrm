import { useCallback, useState } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { parseGeoPoint } from '../../../../../shared/geo-point.js';
import type { ColumnModel } from '../../types/table.types';
import { validateCell, getColumnValidationRules } from '../../utils/validation';
import { AddressEditor } from '../cells/AddressEditor';
import { CheckboxEditor } from '../cells/CheckboxEditor';
import { ColorEditor } from '../cells/ColorEditor';
import { DateEditor } from '../cells/DateEditor';
import { JsonEditor } from '../cells/JsonEditor';
import { NumberEditor } from '../cells/NumberEditor';
import { RelationEditor } from '../cells/RelationEditor';
import { SelectEditor } from '../cells/SelectEditor';

const GEO_INVALID_FALLBACK = 'Expected "lat, lng" (lat −90…90, lng −180…180)';
const CELL_TEXT_FALLBACK = 'Cell text';

const useGeoInvalidMessage = (): string => {
  try {
    return useLanguage().t('columnSettings.geo.invalid');
  } catch {
    return GEO_INVALID_FALLBACK;
  }
};

const useCellTextLabel = (): string => {
  try {
    return useLanguage().t('columnSettings.cellEditor.textLabel');
  } catch {
    return CELL_TEXT_FALLBACK;
  }
};

export interface CellEditorProps {
  column: ColumnModel;
  draftValue: string;
  onDraftChange: (value: string) => void;
  onCommitEdit: (valueOverride?: string) => void;
  onCancelEdit: () => void;
  rowData?: Record<string, unknown>;
  rawMode?: boolean;
  onNavigateToRelatedRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
  minRowHeight: number;
  fixedRowHeight: number | null;
}

export const CellEditor = ({
  column,
  draftValue,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  rowData,
  rawMode = false,
  onNavigateToRelatedRow,
  minRowHeight,
  fixedRowHeight,
}: CellEditorProps) => {
  const [validationError, setValidationError] = useState<string | null>(null);
  const focusEditor = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => element?.focus(), []);
  const geoInvalidMessage = useGeoInvalidMessage();
  const cellTextLabel = useCellTextLabel();
  const isMultilineText = column.type === 'text';
  const TextInput = isMultilineText ? 'textarea' : 'input';

  const validateDraft = useCallback((value: string) => {
    if (column.type === 'geo_point') {
      const valid = value.trim() === '' || parseGeoPoint(value) !== null;
      return { valid, errors: valid ? [] : [geoInvalidMessage] };
    }
    const rules = getColumnValidationRules(column.config as unknown as Record<string, unknown>);
    return validateCell(value, rules, rowData);
  }, [column, geoInvalidMessage, rowData]);

  if (rawMode) {
    return (
      <input
        type="text"
        value={String(draftValue ?? '')}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommitEdit(draftValue);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancelEdit();
          }
        }}
        onBlur={() => onCommitEdit(draftValue)}
        ref={focusEditor}
        className="w-full h-full px-2 py-1 text-sm bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:ring-inset font-mono"
      />
    );
  }

  if (column.type === 'relation' && column.config?.relation?.enabled) {
    return (
      <div className="relative h-full w-full">
        <RelationEditor
          value={draftValue}
          relation={column.config.relation}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
          onNavigateToRow={onNavigateToRelatedRow}
        />
      </div>
    );
  }

  if (column.type === 'select' && (column.config?.options || column.config?.relation?.enabled)) {
    return (
      <div className="relative h-full w-full">
        <SelectEditor
          value={draftValue}
          options={column.config?.options || []}
          relation={column.config?.relation}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  if (column.type === 'multi-select' && column.config?.options) {
    return (
      <div className="relative h-full w-full">
        <SelectEditor
          value={draftValue}
          options={column.config?.options || []}
          relation={column.config?.relation}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
          multiple
        />
      </div>
    );
  }

  if (column.type === 'checkbox') {
    return (
      <CheckboxEditor
        value={draftValue}
        config={column.config?.checkbox}
        onChange={onDraftChange}
        onCommit={() => onCommitEdit()}
      />
    );
  }

  if (column.type === 'color') {
    return (
      <div className="relative h-full w-full">
        <ColorEditor
          value={draftValue}
          config={column.config?.color}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  if (column.type === 'json') {
    return (
      <div className="relative h-full w-full">
        <JsonEditor
          value={String(draftValue ?? '')}
          config={column.config?.json}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  if (column.type === 'address') {
    return (
      <div className="relative h-full w-full">
        <AddressEditor
          value={String(draftValue ?? '')}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  if (column.type === 'date' || column.type === 'datetime') {
    return (
      <div className="relative h-full w-full">
        <DateEditor
          value={draftValue}
          onChange={onDraftChange}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
          showTime={column.type === 'datetime'}
          dateFormat={column.config?.date?.storageFormat ?? column.config?.date?.dateFormat ?? 'iso'}
          mode={column.config?.date?.mode}
        />
      </div>
    );
  }

  if (column.type === 'number') {
    return (
      <div className="relative h-full w-full">
        <NumberEditor
          value={draftValue}
          step={column.config?.number?.step ?? 1}
          min={column.config?.number?.min}
          max={column.config?.number?.max}
          onChange={(value) => onDraftChange(String(value))}
          onCommit={(value) => onCommitEdit(value != null ? String(value) : undefined)}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ minHeight: fixedRowHeight || minRowHeight }}>
      <TextInput
        data-testid="cell-input"
        aria-label={column.displayName || column.name || cellTextLabel}
        aria-invalid={Boolean(validationError)}
        ref={focusEditor}
        value={draftValue}
        onChange={(event) => {
          const newValue = event.target.value;
          onDraftChange(newValue);
          const result = validateDraft(newValue);
          setValidationError(result.valid ? null : result.errors[0] || null);
        }}
        onBlur={() => {
          const result = validateDraft(draftValue);
          if (result.valid) {
            setValidationError(null);
            onCommitEdit();
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && (!isMultilineText || event.shiftKey)) {
            event.preventDefault();
            const result = validateDraft(draftValue);
            if (result.valid) {
              setValidationError(null);
              onCommitEdit();
            }
          } else if (event.key === 'Escape') {
            setValidationError(null);
            onCancelEdit();
          }
        }}
        className={`absolute inset-0 h-full w-full resize-none rounded border px-2 py-1 text-sm ${
          validationError
            ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
            : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
        }`}
      />
      {validationError && (
        <div role="alert" className="absolute bottom-0 left-0 right-0 z-50 px-2 py-1 text-xs text-white bg-red-500 rounded">
          {validationError}
        </div>
      )}
    </div>
  );
};
