import { logger } from '@/shared/utils/logger';
import { canonicalizeColumnType } from '../../../../../shared/column-types.js';
import { parseRelationValues, resolveLens } from '../../utils/resolveLens';
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
  JsonTableCell,
  GeoPointCell,
  AddressCell,
} from '../cells';


// Helper function to parse multi-select values (same parser as the multi-value cells)
export const parseMultiSelectValue = (value: unknown): string[] => parseRelationValues(value);

/** Multi-value cells always split lists (their historical behaviour); single-value cells keep one key. */
const MULTI_VALUE_TYPES = new Set(['multi-select', 'relation']);

export const renderCellValue = ({ column, columns, value, rowId, rowData, rawMode, isInlineExpanded, onOpenNestedTable, onToggleInlineExpand, onNavigateToRow, onAutomationTrigger, rowMutation, rows, tableId, relations }: RenderCellOptions & { rowMutation: any, rows: Array<{ id: string; data: Record<string, unknown> }>, tableId?: number | string }) => {
  const relation = column.config?.relation;

  // Debug: log column type for relation columns
  if (column.type === 'relation' || relation?.lookupMode === 'reverse') {
    logger.debug('[renderCellValue] relation column:', { columnId: column.id, columnName: column.name, type: column.type, rowId, hasRelation: Boolean(relation) });
  }

  const normalizedType = canonicalizeColumnType(column.type);

  // ADR-205 D4: resolve the lens once, before the type switch. The server map is
  // keyed by column name; legacy rows keyed by column id fall back to the id.
  const lensMap = relations ? (relations[column.name] ?? relations[column.id]) : undefined;
  const lensed = resolveLens(value, relation, lensMap, MULTI_VALUE_TYPES.has(normalizedType) ? 'auto' : undefined);
  // Cells that render their own type (image gallery, file, url, number) get the resolved value; raw mode keeps the stored key.
  const lensedValue = lensed.mapped && !rawMode ? lensed.value : value;

  switch (normalizedType) {
    case 'text':
      // Text column - show text, optionally with label from related table
      return <TextCell value={value} rawMode={rawMode} cellFormat={column.config?.cellFormat} textConfig={column.config?.text} relation={relation} lensed={lensed} rowData={rowData} onValueChange={
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
      return <NumberCell value={lensedValue} rawMode={rawMode} config={column.config?.number} rowData={rowData} />;

    case 'email':
      return <EmailCell value={value} rawMode={rawMode} />;

    case 'url':
      return <UrlCell value={lensedValue} rawMode={rawMode} config={column.config} rowData={rowData} />;

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
      return <SelectCell value={value} options={column.config?.options} relation={relation} lensed={lensed} rawMode={rawMode} />;

    case 'relation':
      // Relation - link to rows in another table with navigation to edit
      return <RelationCell value={value} relation={relation} lensed={lensed} rawMode={rawMode} rowId={rowId} onNavigateToRow={onNavigateToRow} />;

    case 'multi-select':
      // Multi-select - can work with static options or relation to table
      return <MultiSelectCell value={value} options={column.config?.options} relation={relation} lensed={lensed} rawMode={rawMode} />;

    case 'table':
      // Embedded table - shows filtered view of another table
      return <TableCell value={value} column={column} rowData={rowData} rowId={rowId} rawMode={rawMode} isExpanded={isInlineExpanded} onOpenNestedTable={onOpenNestedTable as any} onToggleInlineExpand={onToggleInlineExpand} />;

    case 'password':
      return <PasswordCell value={value} rawMode={rawMode} />;

    case 'file': {
      const row = rows.find(row => row.id === rowId);
      return <FileCell value={lensedValue} rawMode={rawMode} config={column.config} rowData={rowData} readOnly={column.isReadonly || lensed.mapped}
        tableId={tableId === undefined ? undefined : Number(tableId)} rowId={rowId} columnId={column.id}
        onUpdate={row ? (newValue) => {
          rowMutation.mutate({ rowId: row.id, columnId: column.id, value: newValue, data: { ...row.data, [column.id]: newValue } });
        } : undefined}
      />;
    }

    case 'image':
      // A lensed image column shows the related row's files; uploading into it would overwrite the key.
      return <ImageCell value={lensedValue} rawMode={rawMode} config={column.config} rowData={rowData} readOnly={column.isReadonly || lensed.mapped} tableId={tableId as any} rowId={rowId} columnId={column.id} onUpdate={(newValue) => {
        if (!rowId) return;
        const row = rows?.find(r => r.id === rowId);
        if (row) {
          const nextData = { ...row.data, [column.id]: newValue };
          rowMutation.mutate({ rowId, columnId: column.id, value: newValue, data: nextData });
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
      return <RollupCell value={value} config={column.config} rowData={rowData} columns={columns} rawMode={rawMode} />;

    case 'verification':
      return <VerificationCell value={value} rawMode={rawMode} />;

    case 'json': {
      // ADR-0017 Phase 3: JSON cell uses JsonColumnConfig (prettyInCell, previewLines)
      const jsonConfig = column.config?.json;
      if (jsonConfig?.cellView === 'table' && !rawMode) {
        const row = rowId ? rows?.find(r => r.id === rowId) : undefined;
        return (
          <JsonTableCell
            value={value}
            config={jsonConfig}
            onChange={row && !column.isReadonly ? (json) => {
              rowMutation.mutate({ rowId: row.id, columnId: column.id, value: json, data: { ...row.data, [column.id]: json } });
            } : undefined}
          />
        );
      }
      return <JsonCell value={value} config={jsonConfig} rawMode={rawMode} />;
    }

    case 'geo_point': {
      // ADR-0035 Slice 1: pin chip, click → external map; paste → shared parser → PUT the cell.
      const row = rowId ? rows?.find(r => r.id === rowId) : undefined;
      return (
        <GeoPointCell
          value={value}
          rawMode={rawMode}
          readOnly={column.isReadonly || !row}
          onPastePoint={row ? (point) => {
            const next = { ...point, source: 'paste' };
            rowMutation.mutate({ rowId: row.id, columnId: column.id, value: next, data: { ...row.data, [column.id]: next } });
          } : undefined}
        />
      );
    }

    case 'address': {
      // ADR-0035-A: one-line label (name → name_template → formatted), click → OSM by the linked
      // geo_point when filled, else OSM search by `formatted`; paste → plain string → server stores {formatted}.
      const row = rowId ? rows?.find(r => r.id === rowId) : undefined;
      const addressConfig = column.config?.address;
      const geoColumnId = addressConfig?.geo_column_id;
      const geoColumn = geoColumnId != null ? columns?.find(c => String(c.id) === String(geoColumnId)) : undefined;
      const linkedPoint = geoColumn ? (rowData?.[geoColumn.name] ?? rowData?.[geoColumn.id]) : undefined;
      return (
        <AddressCell
          value={value}
          rawMode={rawMode}
          readOnly={column.isReadonly || !row}
          rowData={rowData}
          nameTemplate={addressConfig?.name_template}
          linkedPoint={linkedPoint}
          onPasteAddress={row ? (text) => {
            rowMutation.mutate({ rowId: row.id, columnId: column.id, value: text, data: { ...row.data, [column.id]: text } });
          } : undefined}
        />
      );
    }

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
        return <RelationCell value={value} relation={relation} lensed={lensed} rawMode={rawMode} rowId={rowId} onNavigateToRow={onNavigateToRow} />;
      }
      return <TextCell value={value} rawMode={rawMode} />;
  }
};
