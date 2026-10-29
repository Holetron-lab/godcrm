/**
 * TypeTab — Type settings tab for column configuration
 * Contains column type selector, default value, type-specific settings,
 * select/multi-select options editor, validation rules, and column mapping
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React from 'react';
import { canonicalizeColumnType } from '../../../../../../shared/column-types.js';
import { Select } from '@/shared/components/ui';
import type { ColumnModel, ColumnRelationConfig } from '@/features/tables/types/table.types';
import type { ColumnType } from '@/shared/types';
import { COLUMN_TYPE_METADATA, getColumnTypeOptions } from '@/shared/types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { isSystemColumnId } from '@/features/tables/utils/systemColumns';
import { DefaultValueInput } from './DefaultValueInput';
import { SelectOptionsEditor } from './SelectOptionsEditor';
import { MappingSection } from './MappingSection';
import type { TFunction } from './shared';
import {
  DateColumnSettings,
  TimeColumnSettings,
  NumberColumnSettings,
  CheckboxColumnSettings,
  UrlColumnSettings,
  TextColumnSettings,
  VectorColumnSettings,
  ButtonColumnSettings,
  FileColumnSettings,
  ImageColumnSettings,
  RelationColumnSettings,
  TableColumnSettings,
  RollupColumnSettings,
  EmailColumnSettings,
  PhoneColumnSettings,
  PasswordColumnSettings,
  PersonColumnSettings,
  ColorColumnSettings,
  VerificationColumnSettings,
  JsonColumnSettings,
  GeoColumnSettings,
  ValidationRulesSettings,
} from './index';

interface TypeTabProps {
  draft: ColumnModel;
  setDraft: React.Dispatch<React.SetStateAction<ColumnModel | null>>;
  column: ColumnModel | null;
  t: TFunction;
  options: Array<{ label: string; value: string; color?: string; children?: Array<{ label: string; value: string; color?: string }> }>;
  allColumns: ColumnModel[];
  firstRow: Record<string, unknown> | null;
  rows: Array<{ id: string; data: Record<string, unknown> }>;
  /** ADR-0035-A: space of the table, for the address «Geocoder» key-name list. */
  spaceId?: number;
  relationConfig: ColumnRelationConfig | undefined;
  relationTableId: string | undefined;
  relationTableColumns: ColumnModel[];
  relationProjectTables: Array<{ id: string; displayName?: string; name: string }>;
  currentTableColumns: Array<{ name: string; displayName: string; type: string }>;
  availableTables: Array<{ id: string; displayName?: string; name: string }>;
  importTableColumns: ColumnModel[];
  handleExportOptionsCsv: () => void;
  handleImportOptionsCsv: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleImportFromTable: () => void;
  importFromTableOpen: boolean;
  setImportFromTableOpen: (open: boolean) => void;
  importTableId: string;
  setImportTableId: (id: string) => void;
  importValueColumn: string;
  setImportValueColumn: (col: string) => void;
  importLabelColumn: string;
  setImportLabelColumn: (col: string) => void;
  currentMappingRow: Record<string, unknown> | null;
  mappingRowIndex: number;
  mappingRows: Array<{ id: string; data: Record<string, unknown> }>;
  goToPrevMappingRow: () => void;
  goToNextMappingRow: () => void;
  optionsSubTab: 'options' | 'formula';
  setOptionsSubTab: (tab: 'options' | 'formula') => void;
  setActiveTab: (tab: string) => void;
}

export const TypeTab = ({
  draft,
  setDraft,
  column,
  t,
  options,
  allColumns,
  firstRow,
  rows,
  spaceId,
  relationConfig,
  relationTableId,
  relationTableColumns,
  relationProjectTables,
  currentTableColumns,
  availableTables,
  importTableColumns,
  handleExportOptionsCsv,
  handleImportOptionsCsv,
  handleImportFromTable,
  importFromTableOpen,
  setImportFromTableOpen,
  importTableId,
  setImportTableId,
  importValueColumn,
  setImportValueColumn,
  importLabelColumn,
  setImportLabelColumn,
  currentMappingRow,
  mappingRowIndex,
  mappingRows,
  goToPrevMappingRow,
  goToNextMappingRow,
  optionsSubTab,
  setOptionsSubTab,
  setActiveTab,
}: TypeTabProps) => {
  const { language } = useLanguage();
  const columnTypes = getColumnTypeOptions(language);
  const settingsType = canonicalizeColumnType(draft.type);
  // Preserve the selected legacy type when editing an existing column.
  if (!columnTypes.some(({ value }) => value === draft.type)) {
    const meta = COLUMN_TYPE_METADATA[draft.type];
    columnTypes.push({ value: draft.type, label: (language === 'en' ? meta?.labelEn : meta?.label) ?? draft.type });
  }
  return (
    <div className="space-y-4">
      <Select
        label={t('columnSettings.columnType')}
        value={draft.type}
        onChange={(value) => setDraft({ ...draft, type: value as ColumnType })}
        options={columnTypes}
        disabled={isSystemColumnId(draft.id)}
      />
      <DefaultValueInput
        type={settingsType as ColumnType}
        value={draft.defaultValue}
        onChange={(value) => setDraft({ ...draft, defaultValue: value })}
        options={options}
        allColumns={allColumns}
        t={t}
      />

      {/* Date settings */}
      {((draft.type as string) === 'date' || draft.type === 'datetime') && (
        <DateColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* Time settings */}
      {draft.type === 'time' && (
        <TimeColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
        />
      )}

      {/* Number settings */}
      {(draft.type === 'number' || (draft.type as string) === 'integer' || (draft.type as string) === 'float' || (draft.type as string) === 'decimal') && (
        <NumberColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Select/Multi-select options editor */}
      {(settingsType === 'select' || settingsType === 'multi-select') && (
        <SelectOptionsEditor
          key={`${column?.tableId}:${column?.id}:${draft.type}`}
          draft={draft}
          setDraft={setDraft}
          column={column}
          t={t}
          options={options}
          relationConfig={relationConfig}
          availableTables={availableTables}
          importTableColumns={importTableColumns}
          handleExportOptionsCsv={handleExportOptionsCsv}
          handleImportOptionsCsv={handleImportOptionsCsv}
          handleImportFromTable={handleImportFromTable}
          importFromTableOpen={importFromTableOpen}
          setImportFromTableOpen={setImportFromTableOpen}
          importTableId={importTableId}
          setImportTableId={setImportTableId}
          importValueColumn={importValueColumn}
          setImportValueColumn={setImportValueColumn}
          importLabelColumn={importLabelColumn}
          setImportLabelColumn={setImportLabelColumn}
          optionsSubTab={optionsSubTab}
          setOptionsSubTab={setOptionsSubTab}
          setActiveTab={setActiveTab}
        />
      )}

      {/* Checkbox settings */}
      {settingsType === 'checkbox' && (
        <CheckboxColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* URL settings */}
      {draft.type === 'url' && (
        <UrlColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Text settings */}
      {draft.type === 'text' && (
        <TextColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Vector settings */}
      {draft.type === 'vector' && (
        <VectorColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* Button settings */}
      {draft.type === 'button' && (
        <ButtonColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* File settings */}
      {draft.type === 'file' && (
        <FileColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Image settings */}
      {draft.type === 'image' && (
        <>
          <ImageColumnSettings
            draft={draft}
            setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
            allColumns={allColumns}
            firstRow={firstRow}
          />
          <FileColumnSettings
            draft={draft}
            setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
            allColumns={allColumns}
            firstRow={firstRow}
          />
        </>
      )}

      {/* Relation settings — ADR-205 D1: any column type can be a lens; image/file/url/number
          keep their prefix/suffix in their own section above, the lens only swaps the key. */}
      {['relation', 'image', 'file', 'url', 'number'].includes(draft.type) && (
        <RelationColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          relationTableId={relationTableId}
          relationTableColumns={relationTableColumns}
          relationProjectTables={relationProjectTables}
          firstRow={firstRow}
        />
      )}

      {/* Table settings */}
      {draft.type === 'table' && (
        <TableColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          relationTableColumns={relationTableColumns}
          currentTableColumns={currentTableColumns}
          firstRow={firstRow}
        />
      )}

      {/* Rollup settings */}
      {draft.type === 'rollup' && (
        <RollupColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Email settings */}
      {draft.type === 'email' && (
        <EmailColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* Phone settings */}
      {draft.type === 'phone' && (
        <PhoneColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* Password settings */}
      {draft.type === 'password' && (
        <PasswordColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
        />
      )}

      {/* Person settings */}
      {settingsType === 'user' && (
        <PersonColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Color settings (ADR-028) */}
      {draft.type === 'color' && (
        <ColorColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* Verification settings (ADR-0011) */}
      {(draft.type as string) === 'verification' && (
        <VerificationColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
        />
      )}

      {/* JSON settings (ADR-0017 Phase 2) */}
      {(draft.type as string) === 'json' && (
        <JsonColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          firstRow={firstRow}
          rows={rows}
        />
      )}

      {/* «Гео» settings (ADR-0035 / ADR-0035-A): geo_point hint; address → linked point, label template, geocoder */}
      {(draft.type === 'geo_point' || draft.type === 'address') && (
        <GeoColumnSettings
          draft={draft}
          setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
          allColumns={allColumns}
          firstRow={firstRow}
          spaceId={spaceId}
        />
      )}

      {/* Validation rules */}
      <ValidationRulesSettings
        draft={draft}
        setDraft={(updater) => setDraft(typeof updater === 'function' ? updater(draft) : updater)}
      />

      {/* Column mapping */}
      {currentMappingRow && (
        <MappingSection
          draft={draft}
          t={t}
          allColumns={allColumns}
          currentMappingRow={currentMappingRow}
          mappingRowIndex={mappingRowIndex}
          mappingRows={mappingRows}
          goToPrevMappingRow={goToPrevMappingRow}
          goToNextMappingRow={goToNextMappingRow}
        />
      )}
    </div>
  );
};
