/**
 * TypeTab — Type settings tab for column configuration
 * Contains column type selector, default value, type-specific settings,
 * select/multi-select options editor, validation rules, and column mapping
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React from 'react';
import { Select } from '@/shared/components/ui';
import type { ColumnModel, ColumnRelationConfig } from '@/features/tables/types/table.types';
import type { ColumnType } from '@/shared/types';
import { COLUMN_TYPE_METADATA } from '@/shared/types';
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
  return (
    <div className="space-y-4">
      <Select
        label={t('columnSettings.columnType')}
        value={draft.type}
        onChange={(value) => setDraft({ ...draft, type: value as ColumnType })}
        options={Object.entries(COLUMN_TYPE_METADATA).map(([value, meta]) => ({
          value,
          label: meta.label
        }))}
      />
      <DefaultValueInput
        type={draft.type}
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
      {(draft.type === 'select' || draft.type === 'multi-select') && (
        <SelectOptionsEditor
          draft={draft}
          setDraft={setDraft}
          column={column}
          t={t}
          options={options}
          rows={rows}
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
      {draft.type === 'checkbox' && (
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

      {/* Relation settings */}
      {draft.type === 'relation' && (
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
      {draft.type === 'person' && (
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
