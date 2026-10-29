import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '../../api/tablesApi';
import { freezeExcelImport } from './excel-utils';
import type { CSVFileData, ExcelImportState } from './types';

export interface ExcelImportOptions {
  projectId: number;
  useFirstRowAsHeaders: boolean;
  description: string;
  // Frozen state is written back to the file entry before every network step,
  // so a failed attempt can be retried with the same keys and payloads.
  persist: (state: ExcelImportState) => void;
}

export interface ExcelImportResult {
  state: ExcelImportState;
  tableId: number;
  replayed: boolean;
}

// Creates the table (schema included) and imports rows in retry-safe batches
// per backend/services/README.excel-import.md. Never generates a second
// table/key for the same chosen sheet: a retry continues from the frozen state.
export async function runExcelImport(file: CSVFileData, options: ExcelImportOptions): Promise<ExcelImportResult> {
  if (!file.excel || file.excel.sheetIndex === null) {
    throw new Error(`Excel sheet is not selected for ${file.fileName}`);
  }
  let state: ExcelImportState = file.excel.importState
    ?? freezeExcelImport(file, options.projectId, options.useFirstRowAsHeaders, options.description);
  state = { ...state, error: null };
  options.persist(state);

  try {
    if (!state.tableId) {
      const response = await apiClient.request<{ data: { table: { id: number | string } } }>('/tables', {
        method: 'POST',
        body: state.createBody,
      });
      const tableId = Number(response?.data?.table?.id);
      if (!Number.isFinite(tableId) || tableId <= 0) throw new Error('Table creation returned no id');
      state = { ...state, tableId };
      options.persist(state);
    }

    let replayed = false;
    for (const batch of state.batches) {
      if (state.completedBatchIds.includes(batch.importId)) continue;
      const result = await tablesApi.importRows(String(state.tableId), {
        importId: batch.importId,
        mode: 'add',
        rows: batch.rows,
      });
      if (result.replayed) replayed = true;
      state = {
        ...state,
        completedBatchIds: [...state.completedBatchIds, batch.importId],
        importedRows: state.importedRows + (result.imported ?? result.stats?.added ?? batch.rows.length),
      };
      options.persist(state);
    }
    return { state, tableId: state.tableId as number, replayed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state = { ...state, error: message };
    options.persist(state);
    throw err;
  }
}
