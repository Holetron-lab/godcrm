import { beforeEach, describe, expect, it } from 'vitest';
import { useTablesStore } from '../tablesStore';
import type { ColumnModel, RowModel, TableModel } from '../../types/table.types';

const sampleTable: TableModel = {
  id: '1',
  userId: 'u1',
  name: 'users',
  displayName: 'Users',
  type: 'system',
  isVisible: true,
  createdAt: '',
  updatedAt: ''
};
const sampleColumn: ColumnModel = {
  id: 'c1',
  tableId: '1',
  name: 'name',
  displayName: 'Name',
  type: 'text',
  config: {},
  isRequired: false,
  isReadonly: false,
  orderIndex: 0,
  width: 120,
  isVisible: true,
  createdAt: '',
  updatedAt: ''
};
const sampleRow: RowModel = {
  id: 'r1',
  tableId: '1',
  data: { name: 'John' },
  createdAt: '',
  updatedAt: '',
  createdBy: 'u1'
};

beforeEach(() => {
  useTablesStore.setState({
    tables: [],
    columns: {},
    rows: {},
    activeTableId: null,
    loading: false,
    error: null,
    contextUserId: null,
    personalSummary: null
  });
});

describe('tablesStore', () => {
  it('stores tables and selects active table', () => {
    useTablesStore.getState().setTables([sampleTable]);
    useTablesStore.getState().selectTable('1');
    expect(useTablesStore.getState().tables).toHaveLength(1);
    expect(useTablesStore.getState().activeTableId).toBe('1');
  });

  it('updates row cell value immutably', () => {
    useTablesStore.getState().setRows('1', [sampleRow]);
    useTablesStore.getState().updateCell('1', 'r1', 'name', 'Jane');
    const rows = useTablesStore.getState().rows['1'];
    expect(rows?.[0].data.name).toBe('Jane');
  });

  it('updates column visibility in store', () => {
    useTablesStore.getState().setColumns('1', [sampleColumn]);
    useTablesStore.getState().setColumnVisibility('1', 'c1', false);
    const column = useTablesStore.getState().columns['1']?.[0];
    expect(column?.isVisible).toBe(false);
  });

  it('updates column width in store', () => {
    useTablesStore.getState().setColumns('1', [sampleColumn]);
    useTablesStore.getState().setColumnWidth('1', 'c1', 240);
    const column = useTablesStore.getState().columns['1']?.[0];
    expect(column?.width).toBe(240);
  });
});
