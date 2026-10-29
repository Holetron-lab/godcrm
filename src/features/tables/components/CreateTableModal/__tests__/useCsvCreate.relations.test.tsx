import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCsvCreate } from '../useCsvCreate';
import type { CSVFileData } from '../types';
const api = vi.hoisted(() => ({
  createTable: vi.fn(), createColumn: vi.fn(), importRows: vi.fn(),
  getRows: vi.fn(async () => ({ rows: [{ id: '9', data: { notion_id: 'notion-key', name: 'Target' } }] })),
  getColumns: vi.fn(async () => ({ columns: [{ id: '77', name: 'target' }] })),
  updateColumn: vi.fn(),
}));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: api }));
vi.mock('../../../hooks/useCreateTable', () => ({ useCreateTable: () => ({ isPending: false }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ refetchQueries: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
const params: Parameters<typeof useCsvCreate>[0] = {
  csvFiles: [], csvFilesBeforeNotionImport: null, targetProjectId: 1, useFirstRowAsHeaders: true,
  setCsvCreating: vi.fn(), setCsvStep: vi.fn(), resetState: vi.fn(), onOpenChange: vi.fn(),
  tableType: 'local', basic: { displayName: 'Orders', name: 'orders', description: '', icon: '', color: '' },
  derivedName: 'orders', hierarchy: { mode: 'flat' }, columns: [], selectedDataSource: '',
  selectedExternalTable: '', selectedRelatedTables: [], showInMenu: false, menuWidgetTitle: '',
  menuWidgetIcon: '', menuWidgetDescription: '', slugify: value => value,
};


it('configures imported relations from the columns envelope returned by tablesApi', async () => {
  const target: CSVFileData = {
    id: 'target-file', fileName: 'Target.csv', tableName: 'target', tableDisplayName: 'Target',
    tableDescription: '', icon: '', color: null, showInMenu: false,
    menuWidgetTitle: '', menuWidgetIcon: '', menuWidgetDescription: '',
    data: [['name'], ['Target']], headers: ['name'],
    columnDefinitions: [{ colIndex: 0, csvColumn: 'name', name: 'name', displayName: 'Name', type: 'text' }],
  };
  const source: CSVFileData = { ...target, id: 'source-file', tableName: 'source',
    headers: ['target'], data: [['target'], ['Target']],
    columnDefinitions: [{ colIndex: 0, csvColumn: 'target', name: 'target', displayName: 'Target', type: 'relation',
      relationTargetFileId: target.id, relationValueColumn: 'notion_id', relationLabelColumn: 'name' }],
  };
  api.createTable.mockResolvedValueOnce({ table: { id: '42' } }).mockResolvedValueOnce({ table: { id: '43' } });
  const { result } = renderHook(() => useCsvCreate({ ...params, csvFiles: [target, source] }));
  await result.current.handleCsvCreate();
  expect(api.updateColumn).toHaveBeenCalledWith('43', '77', expect.objectContaining({
    type: 'relation', config: expect.objectContaining({ relation: expect.objectContaining({ tableId: '42' }) }),
  }));
});
