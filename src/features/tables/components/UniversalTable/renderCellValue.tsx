import { logger } from '@/shared/utils/logger';
import type { RenderCellOptions } from './types';
import {
  TextCell,
  NumberCell,
  CheckboxCell,
  DateCell,
  TimeCell,
  SelectCell,
  MultiSelectCell,
  PasswordCell,
  EmailCell,
  UrlCell,
  PhoneCell,
  ButtonCell,
  RelationCell,
  TableCell,
  FileCell,
  ImageCell,
  AudioCell,
  VectorCell,
  RollupCell,
  ColorCell,
  VerificationCell,
  JsonCell,
} from '../cells';


// Helper function to parse multi-select values (same logic as MultiSelectCell)
export const parseMultiSelectValue = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return [];

  // Already an array
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(Boolean);
  }

  const stringValue = String(value);

  // Try JSON parse first
  if (stringValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(stringValue);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v)).filter(Boolean);
      }
    } catch {
      // Not valid JSON, continue with other formats
    }
  }

  // Auto-detect delimiter
  if (stringValue.includes(',')) {
    return stringValue.split(',').map(v => v.trim()).filter(Boolean);
  }
  if (stringValue.includes(';')) {
    return stringValue.split(';').map(v => v.trim()).filter(Boolean);
  }

  return [stringValue];
};

export const renderCellValue = ({ column, value, rowId, rowData, rawMode, isInlineExpanded, onOpenNestedTable, onToggleInlineExpand, onNavigateToRow, onAutomationTrigger, rowMutation, rows, tableId }: RenderCellOptions & { rowMutation: any, rows: Array<{ id: string; data: Record<string, unknown> }>, tableId?: number | string }) => {
  const relation = column.config?.relation;

  // Debug: log column type for relation columns
  if (column.type === 'relation' || relation?.lookupMode === 'reverse') {
    logger.debug('[renderCellValue] relation column:', { columnId: column.id, columnName: column.name, type: column.type, rowId, hasRelation: Boolean(relation) });
  }

  // ADR-0041 P0: alias-shim for legacy DB types until P1 data migration runs.
  // Backend keeps its shim permanently (decision #2); this frontend shim is
  // removed in P2 once `table_columns.type` no longer holds legacy values.
  const rawType = column.type as string;
  const normalizedType =
    rawType === 'boolean' ? 'checkbox' :
    (rawType === 'multi_select' || rawType === 'multiselect') ? 'multi-select' :
    (rawType === 'longtext' || rawType === 'richText' || rawType === 'rich_text') ? 'long_text' :
    rawType === 'textarea' ? 'text' :
    rawType;

  switch (normalizedType) {
    case 'text':
      // Text column - show text, optionally with label from related table
      return <TextCell value={value} rawMode={rawMode} cellFormat={column.config?.cellFormat} textConfig={column.config?.text} relation={relation} rowData={rowData} onValueChange={
        column.config?.cellFormat?.mode === 'markdown' && rowId ? (newValue: string) => {
          const row = rows?.find(r => r.id === rowId);
          if (row) {
            const nextData = { ...row.data, [column.id]: newValue };
            rowMutation.updateRow.mutate({ rowId, data: nextData });
          }
        } : undefined
      } />;

    case 'number':
    case 'integer':
    case 'float':
    case 'decimal':
      return <NumberCell value={value} rawMode={rawMode} config={column.config?.number} rowData={rowData} />;

    case 'email':
      return <EmailCell value={value} rawMode={rawMode} />;

    case 'url':
      return <UrlCell value={value} rawMode={rawMode} config={column.config} rowData={rowData} />;

    case 'phone':
      return <PhoneCell value={value} rawMode={rawMode} />;

    case 'date':
      return <DateCell value={value} showTime={false} dateFormat={column.config?.date?.storageFormat ?? column.config?.date?.dateFormat ?? 'iso'} displayFormat={column.config?.date?.displayFormat} rawMode={rawMode} storageFormat={column.config?.date?.storageFormat} mode={column.config?.date?.mode} />;

    case 'datetime':
      return <DateCell value={value} showTime={true} dateFormat={column.config?.date?.storageFormat ?? column.config?.date?.dateFormat ?? 'iso'} displayFormat={column.config?.date?.displayFormat} rawMode={rawMode} storageFormat={column.config?.date?.storageFormat} mode={column.config?.date?.mode} />;

    case 'time':
      return <TimeCell value={value} rawMode={rawMode} config={(column.config as any)?.time} />;

    case 'checkbox':
      return <CheckboxCell value={value} config={column.config?.checkbox} rawMode={rawMode} />;

    case 'select':
      // Select - simple choice from options (can load options from related table)
      return <SelectCell value={value} options={column.config?.options} relation={relation} rawMode={rawMode} />;

    case 'relation':
      // Relation - link to rows in another table with navigation to edit
      return <RelationCell value={value} relation={relation} rawMode={rawMode} rowId={rowId} onNavigateToRow={onNavigateToRow} />;

    case 'multi-select':
      // Multi-select - can work with static options or relation to table
      return <MultiSelectCell value={value} options={column.config?.options} relation={relation} rawMode={rawMode} />;

    case 'table':
      // Embedded table - shows filtered view of another table
      return <TableCell value={value} column={column} rowData={rowData} rowId={rowId} rawMode={rawMode} isExpanded={isInlineExpanded} onOpenNestedTable={onOpenNestedTable as any} onToggleInlineExpand={onToggleInlineExpand} />;

    case 'password':
      return <PasswordCell value={value} rawMode={rawMode} />;

    case 'file':
      return <FileCell value={value} rawMode={rawMode} config={column.config} rowData={rowData} readOnly={column.isReadonly} />;

    case 'image':
      return <ImageCell value={value} rawMode={rawMode} config={column.config} rowData={rowData} readOnly={column.isReadonly} tableId={tableId as any} rowId={rowId} columnId={column.id} onUpdate={(newValue) => {
        if (!rowId) return;
        const row = rows?.find(r => r.id === rowId);
        if (row) {
          const nextData = { ...row.data, [column.id]: newValue };
          rowMutation.updateRow.mutate({ rowId, data: nextData });
        }
      }} />;

    case 'audio':
      return <AudioCell value={value} rawMode={rawMode} config={(column.config as any)?.audio} rowData={rowData} />;

    case 'vector':
      return (
        <VectorCell
          value={value}
          rowData={rowData}
          columnId={column.id}
          tableId={tableId}
          rowId={rowId}
          config={column.config}
          onUpdate={(newValue) => {
            if (!rowId) return;
            const row = rows?.find(r => r.id === rowId);
            if (row) {
              const nextData = { ...row.data, [column.id]: newValue };
              rowMutation.mutate({ rowId, columnId: column.id, value: newValue, data: nextData });
            }
          }}
        />
      );

    case 'button':
      return (
        <ButtonCell
          value={value}
          rowId={rowId || ''}
          rowData={rowData || {}}
          columnId={column.id}
          config={column.config?.button}
          onAutomationTrigger={onAutomationTrigger}
        />
      );

    case 'color':
      return <ColorCell value={value} config={column.config?.color} rawMode={rawMode} />;

    case 'rollup':
      return <RollupCell value={value} config={column.config as any} rowData={rowData} rawMode={rawMode} />;

    case 'verification':
      return <VerificationCell value={value} rawMode={rawMode} />;

    case 'json':
      // ADR-0017 Phase 3: JSON cell uses JsonColumnConfig (prettyInCell, previewLines)
      return <JsonCell value={value} config={column.config?.json} rawMode={rawMode} />;

    case 'long_text': {
      // Long text - show truncated preview or "JSON" badge if it parses as JSON
      if (value === null || value === undefined) {
        return <span className="text-[var(--text-tertiary)]">—</span>;
      }
      const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
      const isJson = typeof value === 'object' || (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{')));
      if (isJson) {
        const preview = jsonStr.length > 50 ? jsonStr.substring(0, 50) + '...' : jsonStr;
        return (
          <div className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary-500/10 text-primary-500 rounded">JSON</span>
            <span className="text-xs text-[var(--text-secondary)] truncate max-w-[200px]" title={jsonStr}>{preview}</span>
          </div>
        );
      }
      return <TextCell value={value} rawMode={rawMode} />;
    }

    case 'formula':
    default:
      // Default types can also have relation lookup
      if (relation?.enabled && (relation.type === 'lookup' || !relation.type)) {
        return <RelationCell value={value} relation={relation} rawMode={rawMode} rowId={rowId} onNavigateToRow={onNavigateToRow} />;
      }
      return <TextCell value={value} rawMode={rawMode} />;
  }
};
