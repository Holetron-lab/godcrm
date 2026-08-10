import { TableGrid } from './TableGrid';
import { TableSkeleton } from './TableSkeleton';
import { TableSummaryBar } from './TableSummaryBar';
import { TableModals } from './TableModals';
import { useUniversalTableState } from './useUniversalTableState';
import type { ColumnModel, RowModel } from '../../types/table.types';
import type { UniversalTableProps, PaginationInfo } from './types';

// Re-export types for consumers
export type { PaginationInfo, UniversalTableProps };

export const UniversalTable = (props: UniversalTableProps = {}) => {
  const state = useUniversalTableState(props);

  const {
    table,
    columns,
    rows,
    allRows,
    sortedRows,
    rowsVersion,
    tableInstance,
    editingCell,
    draftValue,
    setDraftValue,
    columnSizing,
    // Modals state
    createColumnOpen,
    setCreateColumnOpen,
    duplicateModalOpen,
    rowToDuplicate,
    editModalOpen,
    rowToEdit,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    relatedRowModal,
    setRelatedRowModal,
    nestedTableModal,
    setNestedTableModal,
    expandedInlineTables,
    // Column inspector
    activeColumn,
    inspectorOpen,
    setInspectorOpen,
    setActiveColumn,
    // Pagination
    currentPage,
    rowsLimit,
    totalRowsCount,
    totalRows,
    isLoadingMore,
    canLoadMore,
    canLoadPrevious,
    rowsAbove,
    rowsBelow,
    // Export/Import
    exportModalOpen,
    setExportModalOpen,
    importModalOpen,
    setImportModalOpen,
    // Bulk replace
    bulkReplaceModalOpen,
    setBulkReplaceModalOpen,
    executeBulkReplace,
    // Print
    printModalOpen,
    setPrintModalOpen,
    // Row selection
    selectedRowIds,
    selectionSort,
    toggleRowSelection,
    selectAllFiltered,
    clearSelection,
    setSelectionSort,
    isAllSelected,
    isIndeterminate,
    filteredRowIds,
    allRowIds,
    selectAll,
    // Mutations
    createColumnMutation,
    deleteColumnMutation,
    settingsMutation,
    // Handlers
    handleCellClick,
    handleCellDoubleClick,
    handleCommitEdit,
    handleCancelEdit,
    handleCheckboxToggle,
    handleNumberStep,
    handleAddColumn,
    handleEditRow,
    handleDuplicateRow,
    handleDeleteRow,
    handleDeleteSelectedClick,
    handleDeleteSelectedConfirm,
    handleConfirmDuplicateExternal,
    handleSaveEditedRow,
    handleSaveColumnSettings,
    handleColumnReorder,
    handleShowColumn,
    handleOpenColumnSettings,
    handleLoadMore,
    handleLoadPrevious,
    handleToggleInlineTable,
    handleOpenRowChat,
    handleAttachRowToChat,
    handleAttachRowToMessage,
    // Permission flags
    isReadOnlyContext,
    // Hidden columns
    hiddenColumns,
    // Props
    rawMode,
    readOnly,
    disableNestedModals,
    spaceId,
    spaceName,
    projectName,
    showSummaryBar,
    addRowModalOpen,
    onCloseAddRowModal,
    groupByColumn,
  } = state;

  // Early returns AFTER all hooks
  if (!table) {
    return (
      <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-secondary)]">
        Select a table to start working with data.
      </div>
    );
  }

  // Show skeleton while loading data
  if (columns.length === 0 && rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <TableSkeleton rows={8} columns={5} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-max">
      <div>
        <TableGrid
          table={tableInstance}
          columns={columns}
          rows={sortedRows}
          rowsVersion={rowsVersion}
          editingCell={editingCell}
          draftValue={draftValue}
          groupByColumn={groupByColumn}
          onCellDoubleClick={handleCellDoubleClick}
          onDraftChange={setDraftValue}
          onCommitEdit={handleCommitEdit}
          onCancelEdit={handleCancelEdit}
          onAddColumn={handleAddColumn}
          onCellClick={handleCellClick}
          onCheckboxToggle={handleCheckboxToggle}
          onNumberStep={handleNumberStep}
          onEditRow={handleEditRow}
          onDuplicateRow={handleDuplicateRow}
          onDeleteRow={handleDeleteRow}
          onColumnReorder={handleColumnReorder}
          hiddenColumns={hiddenColumns}
          rawMode={rawMode}
          onShowColumn={handleShowColumn}
          onOpenColumnSettings={handleOpenColumnSettings}
          readOnly={isReadOnlyContext}
          isLoadingMore={isLoadingMore}
          expandedInlineTables={expandedInlineTables}
          onToggleInlineTable={handleToggleInlineTable}
          onNavigateToRelatedRow={(tableId, rowId, valueColumn) => setRelatedRowModal({ isOpen: true, tableId, rowId, valueColumn })}
          // Row selection
          selectedRowIds={selectedRowIds}
          onToggleRowSelection={!readOnly && !isReadOnlyContext ? toggleRowSelection : undefined}
          onSelectAllRows={() => selectAll(filteredRowIds)}
          onDeselectAllRows={clearSelection}
          isAllSelected={isAllSelected(filteredRowIds)}
          isSelectionIndeterminate={isIndeterminate(filteredRowIds)}
          // Selection summary bar
          selectionSort={selectionSort}
          onSelectionSortChange={setSelectionSort}
          onClearSelection={clearSelection}
          onSelectAllFiltered={() => selectAllFiltered(filteredRowIds)}
          onDeleteSelected={!readOnly && !isReadOnlyContext ? handleDeleteSelectedClick : undefined}
          filteredCount={filteredRowIds.length}
          totalCount={allRowIds.length}
          // Load more
          canLoadMore={canLoadMore}
          onLoadMore={handleLoadMore}
          canLoadPrevious={canLoadPrevious}
          onLoadPrevious={handleLoadPrevious}
          currentPage={currentPage}
          rowsLimit={rowsLimit}
          totalRows={totalRows}
          rowsAbove={rowsAbove}
          rowsBelow={rowsBelow}
          // Row height settings from table config
          minRowHeight={table?.config?.min_row_height ?? 24}
          maxRowHeight={table?.config?.max_row_height ?? 1200}
          fixedRowHeight={table?.config?.fixed_row_height ?? null}
          // Row chat
          onOpenRowChat={handleOpenRowChat}
          onAttachRowToChat={handleAttachRowToChat}
          onAttachRowToMessage={handleAttachRowToMessage}
        />
      </div>

      {/* Summary Bar (ADR-026) */}
      {showSummaryBar && rows.length > 0 && (
        <TableSummaryBar
          rows={rows as RowModel[]}
          columns={columns as ColumnModel[]}
          table={tableInstance}
        />
      )}

      <TableModals
        table={table}
        columns={columns as ColumnModel[]}
        rows={rows}
        allRows={allRows}
        activeColumn={activeColumn}
        inspectorOpen={inspectorOpen}
        columnSizing={columnSizing}
        settingsMutation={settingsMutation}
        deleteColumnMutation={deleteColumnMutation}
        onInspectorOpenChange={(open) => {
          setInspectorOpen(open);
          if (!open) {
            setActiveColumn(null);
          }
        }}
        onSaveColumnSettings={handleSaveColumnSettings}
        isExternalTable={Boolean(table?.data_source_id)}
        spaceId={spaceId}
        spaceName={spaceName}
        projectName={projectName}
        createColumnOpen={createColumnOpen}
        onCreateColumnOpenChange={setCreateColumnOpen}
        createColumnMutation={createColumnMutation}
        duplicateModalOpen={duplicateModalOpen}
        rowToDuplicate={rowToDuplicate}
        onCloseDuplicate={() => {
          state.setDuplicateModalOpen(false);
          state.setRowToDuplicate(null);
        }}
        onConfirmDuplicateExternal={handleConfirmDuplicateExternal}
        editModalOpen={editModalOpen}
        rowToEdit={rowToEdit}
        onCloseEdit={() => {
          state.setEditModalOpen(false);
          state.setRowToEdit(null);
        }}
        onSaveEditedRow={handleSaveEditedRow}
        relatedRowModal={relatedRowModal}
        onCloseRelatedRow={() => setRelatedRowModal({ isOpen: false, tableId: '', rowId: '' })}
        addRowModalOpen={addRowModalOpen}
        onCloseAddRowModal={onCloseAddRowModal}
        exportModalOpen={exportModalOpen}
        onCloseExportModal={() => setExportModalOpen(false)}
        selectedRowIds={selectedRowIds}
        totalRowsCount={totalRowsCount}
        importModalOpen={importModalOpen}
        onCloseImportModal={() => setImportModalOpen(false)}
        nestedTableModal={nestedTableModal}
        onCloseNestedTable={() => setNestedTableModal(prev => ({ ...prev, isOpen: false }))}
        disableNestedModals={disableNestedModals}
        bulkReplaceModalOpen={bulkReplaceModalOpen}
        onBulkReplaceOpenChange={setBulkReplaceModalOpen}
        filteredRowIds={filteredRowIds}
        allRowIds={allRowIds}
        executeBulkReplace={executeBulkReplace}
        printModalOpen={printModalOpen}
        onPrintOpenChange={setPrintModalOpen}
        deleteConfirmOpen={deleteConfirmOpen}
        onDeleteConfirmOpenChange={setDeleteConfirmOpen}
        onDeleteSelectedConfirm={handleDeleteSelectedConfirm}
      />
    </div>
  );
};
