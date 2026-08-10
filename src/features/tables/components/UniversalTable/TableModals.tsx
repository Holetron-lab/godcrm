import { useLanguage } from '@/shared/i18n/LanguageContext';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { CreateColumnModal } from '../modals/CreateColumnModal';
import { DuplicateExternalRowModal } from '../modals/DuplicateExternalRowModal';
import { EditRowModal } from '../modals/EditRowModal';
import { RelatedRowModal } from '../modals/RelatedRowModal';
import { AddRowModal } from '../modals/AddRowModal';
import { ExportCSVModal, exportToCSV } from '../modals/ExportCSVModal';
import { ExportModal } from '../modals/ExportModal';
import { ImportModal } from '../modals/ImportModal';
import { VerificationGateModal } from '../modals/VerificationGateModal';
import { Modal } from '@/shared/components/ui';
import { NestedTableModal } from '../cells';
import { BulkReplaceModal } from './BulkReplaceModal';
import { PrintModal } from '../PrintModal';
import { ColumnSettingsDrawer } from './ColumnSettingsDrawer';
import { getEffectiveColumnSize } from '../../utils/columnSizing';
import { tablesApi } from '../../api/tablesApi';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnModel, RowModel, ColumnConfig } from '../../types/table.types';
import type { ColumnSizingState } from '@tanstack/react-table';
import type { UseMutationResult } from '@tanstack/react-query';

export interface TableModalsProps {
  table: any;
  columns: any[];
  rows: any[];
  allRows: any[];
  // Column settings drawer
  activeColumn: ColumnModel | null;
  inspectorOpen: boolean;
  columnSizing: ColumnSizingState;
  settingsMutation: { isPending: boolean };
  deleteColumnMutation: { isPending: boolean; mutate: (columnId: string) => void };
  onInspectorOpenChange: (open: boolean) => void;
  onSaveColumnSettings: (columnId: string, payload: Partial<ColumnModel>) => void;
  isExternalTable: boolean;
  spaceId?: number;
  spaceName?: string;
  projectName?: string;
  // Create column modal
  createColumnOpen: boolean;
  onCreateColumnOpenChange: (open: boolean) => void;
  createColumnMutation: { isPending: boolean; mutate: (data: { name: string; displayName: string; type: string; config?: Record<string, any> }) => void };
  // Duplicate modal
  duplicateModalOpen: boolean;
  rowToDuplicate: RowModel | null;
  onCloseDuplicate: () => void;
  onConfirmDuplicateExternal: (data: Record<string, unknown>) => Promise<void>;
  // Edit modal
  editModalOpen: boolean;
  rowToEdit: RowModel | null;
  onCloseEdit: () => void;
  onSaveEditedRow: (data: Record<string, unknown>) => Promise<void>;
  // Related row modal
  relatedRowModal: { isOpen: boolean; tableId: string; rowId: string; valueColumn?: string };
  onCloseRelatedRow: () => void;
  // Add row modal
  addRowModalOpen: boolean;
  onCloseAddRowModal?: () => void;
  // Export modal
  exportModalOpen: boolean;
  onCloseExportModal: () => void;
  selectedRowIds: Set<string>;
  totalRowsCount: number;
  // Import modal
  importModalOpen: boolean;
  onCloseImportModal: () => void;
  // Nested table modal
  nestedTableModal: { isOpen: boolean; tableId: string; filterColumn: string; filterValue: string; config?: any; parentLabel?: string };
  onCloseNestedTable: () => void;
  disableNestedModals: boolean;
  // Bulk replace
  bulkReplaceModalOpen: boolean;
  onBulkReplaceOpenChange: (open: boolean) => void;
  filteredRowIds: any;
  allRowIds: any;
  executeBulkReplace: any;
  // Print modal
  printModalOpen: boolean;
  onPrintOpenChange: (open: boolean) => void;
  // Delete confirmation
  deleteConfirmOpen: boolean;
  onDeleteConfirmOpenChange: (open: boolean) => void;
  onDeleteSelectedConfirm: () => void;
}

export const TableModals = ({
  table,
  columns,
  rows,
  allRows,
  activeColumn,
  inspectorOpen,
  columnSizing,
  settingsMutation,
  deleteColumnMutation,
  onInspectorOpenChange,
  onSaveColumnSettings,
  isExternalTable,
  spaceId,
  spaceName,
  projectName,
  createColumnOpen,
  onCreateColumnOpenChange,
  createColumnMutation,
  duplicateModalOpen,
  rowToDuplicate,
  onCloseDuplicate,
  onConfirmDuplicateExternal,
  editModalOpen,
  rowToEdit,
  onCloseEdit,
  onSaveEditedRow,
  relatedRowModal,
  onCloseRelatedRow,
  addRowModalOpen,
  onCloseAddRowModal,
  exportModalOpen,
  onCloseExportModal,
  selectedRowIds,
  totalRowsCount,
  importModalOpen,
  onCloseImportModal,
  nestedTableModal,
  onCloseNestedTable,
  disableNestedModals,
  bulkReplaceModalOpen,
  onBulkReplaceOpenChange,
  filteredRowIds,
  allRowIds,
  executeBulkReplace,
  printModalOpen,
  onPrintOpenChange,
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
  onDeleteSelectedConfirm,
}: TableModalsProps) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return (
    <>
      <ColumnSettingsDrawer
        column={activeColumn}
        currentWidth={activeColumn ? getEffectiveColumnSize(activeColumn, columnSizing[activeColumn.id] ?? activeColumn.width) : undefined}
        open={inspectorOpen}
        onOpenChange={onInspectorOpenChange}
        onSave={onSaveColumnSettings}
        onDelete={(columnId) => deleteColumnMutation.mutate(columnId)}
        saving={settingsMutation.isPending}
        deleting={deleteColumnMutation.isPending}
        isExternalTable={isExternalTable}
        projectId={table?.projectId ?? undefined}
        tableId={table?.id}
        spaceId={spaceId}
        tableName={table?.displayName || table?.name}
        spaceName={spaceName}
        projectName={projectName}
        rows={rows}
        allColumns={columns}
      />
      <CreateColumnModal
        open={createColumnOpen}
        onOpenChange={onCreateColumnOpenChange}
        onSubmit={(data) => createColumnMutation.mutate(data)}
        loading={createColumnMutation.isPending}
        tableId={table?.id}
        projectId={table?.projectId}
      />
      <DuplicateExternalRowModal
        isOpen={duplicateModalOpen}
        onClose={onCloseDuplicate}
        onConfirm={onConfirmDuplicateExternal}
        rowData={rowToDuplicate?.data || {}}
        columns={columns}
        idColumn={table?.source_id_column || 'id'}
        existingIds={rows.map((r) => r.id)}
      />
      <EditRowModal
        isOpen={editModalOpen}
        onClose={onCloseEdit}
        onSave={onSaveEditedRow}
        columns={columns}
        rowData={rowToEdit?.data || {}}
        rowId={rowToEdit?.id || ''}
        tableId={table?.id}
        tableName={table?.display_name || table?.name}
      />
      <RelatedRowModal
        isOpen={relatedRowModal.isOpen}
        onClose={onCloseRelatedRow}
        tableId={relatedRowModal.tableId}
        rowId={relatedRowModal.rowId}
        valueColumn={relatedRowModal.valueColumn}
      />
      <AddRowModal
        isOpen={addRowModalOpen}
        onClose={() => onCloseAddRowModal?.()}
        onConfirm={async (data) => {
          if (!table?.id) return;
          try {
            await tablesApi.createRow(table.id, data);
            showToast(t('rowActions.addSuccess') || 'Строка добавлена', 'success');
            queryClient.invalidateQueries({ queryKey: ['rows'] });
            onCloseAddRowModal?.(); // Close modal after success
          } catch (error) {
            logger.error('Failed to add row:', error);
            const errorMessage = error instanceof Error ? error.message : t('rowActions.addFailed') || 'Ошибка добавления';
            showToast(errorMessage, 'error');
          }
        }}
        columns={columns}
        tableId={table?.id}
        tableName={table?.displayName || table?.name}
      />
      <ExportCSVModal
        isOpen={exportModalOpen}
        onClose={onCloseExportModal}
        tableName={table?.displayName || table?.name || 'table'}
        columns={columns}
        filteredRows={rows}
        allRows={allRows}
        selectedRowIds={selectedRowIds}
        onExportFiltered={(settings) => {
          const filename = `${table?.displayName || table?.name || 'export'}_filtered_${new Date().toISOString().slice(0, 10)}`;
          exportToCSV(rows, columns, filename, settings);
        }}
        onExportAll={(settings) => {
          const filename = `${table?.displayName || table?.name || 'export'}_full_${new Date().toISOString().slice(0, 10)}`;
          exportToCSV(allRows, columns, filename, settings);
        }}
        onExportSelected={(settings) => {
          const selectedRows = allRows.filter(row => selectedRowIds.has(row.id));
          const filename = `${table?.displayName || table?.name || 'export'}_selected_${new Date().toISOString().slice(0, 10)}`;
          exportToCSV(selectedRows, columns, filename, settings);
        }}
      />
      {/* ImportCSVModal removed - using unified ImportModal with tabs below */}
      {!disableNestedModals && (
        <NestedTableModal
          isOpen={nestedTableModal.isOpen}
          onClose={onCloseNestedTable}
          tableId={nestedTableModal.tableId}
          filterColumn={nestedTableModal.filterColumn}
          filterValue={nestedTableModal.filterValue}
          config={nestedTableModal.config}
          parentLabel={nestedTableModal.parentLabel}
        />
      )}

      {/* Bulk Replace Modal */}
      <BulkReplaceModal
        open={bulkReplaceModalOpen}
        onOpenChange={onBulkReplaceOpenChange}
        columns={columns}
        rows={rows}
        selectedRowIds={selectedRowIds}
        filteredRowIds={filteredRowIds}
        allRowIds={allRowIds}
        onReplace={executeBulkReplace}
        tableInfo={table ? {
          name: table.display_name || table.name || 'Таблица',
          id: String(table.id),
          key: table.name || ''
        } : undefined}
      />

      {/* Print Modal */}
      <PrintModal
        isOpen={printModalOpen}
        onClose={() => onPrintOpenChange(false)}
        columns={columns}
        rows={rows}
        selectedRowIds={selectedRowIds}
        filteredRowIds={filteredRowIds}
        tableName={table?.display_name || table?.name || 'Таблица'}
        spaceName={spaceName}
        projectName={projectName}
        viewType="table"
      />

      {/* Unified Export Modal (JSON/CSV tabs) */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={onCloseExportModal}
        tableId={String(table?.id || '')}
        tableName={table?.display_name || table?.name || 'table'}
        rowsCount={totalRowsCount || allRows.length}
        columns={columns}
        filteredRows={rows}
        allRows={allRows}
        selectedRowIds={selectedRowIds}
      />

      {/* Unified Import Modal (JSON/CSV tabs) */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={onCloseImportModal}
        tableId={String(table?.id || '')}
        tableName={table?.display_name || table?.name || 'table'}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirmOpen}
        onOpenChange={onDeleteConfirmOpenChange}
        title={t('table.bulkDeleteTitle')}
        description={t('table.bulkDeleteConfirm')
          .replace('{count}', String(selectedRowIds.size))
          .replace('{row}', selectedRowIds.size === 1 ? t('table.rowsOne') : selectedRowIds.size < 5 ? t('table.rowsFew') : t('table.rowsMany'))}
        size="sm"
        primaryAction={{
          label: `${t('common.delete')} (${selectedRowIds.size})`,
          variant: 'danger',
          onClick: onDeleteSelectedConfirm
        }}
        secondaryAction={{
          label: t('common.cancel'),
          variant: 'secondary',
          onClick: () => onDeleteConfirmOpenChange(false)
        }}
      >
        <div className="py-4 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
        </div>
      </Modal>

      {/* ADR-0011: Verification gate modal — opens on 409 VERIFICATION_REQUIRED
          / 403 VERIFICATION_IMMUTABLE from row mutations (driven via zustand). */}
      <VerificationGateModal />
    </>
  );
};
