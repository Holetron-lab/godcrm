import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { UniversalTable } from '../UniversalTable';
import { useTablesStore } from '../../../store/tablesStore';
import type { ColumnModel, RowModel, TableModel } from '../../../types/table.types';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

const table: TableModel = {
  id: 'test-table',
  userId: 'u1',
  name: 'test',
  displayName: 'Test Table',
  type: 'system',
  isVisible: true,
  config: {
    defaultView: 'table',
    views: [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [], visibleColumns: ['col-name'] }],
    permissions: {}
  },
  createdAt: '',
  updatedAt: ''
};

const column: ColumnModel = {
  id: 'col-name',
  tableId: table.id,
  name: 'name',
  displayName: 'Name',
  type: 'text',
  config: {},
  isRequired: false,
  isReadonly: false,
  orderIndex: 0,
  width: 180,
  isVisible: true,
  formula: undefined,
  mapping: undefined,
  defaultValue: undefined,
  createdAt: '',
  updatedAt: ''
};

const row: RowModel = {
  id: 'row-1',
  tableId: table.id,
  data: { 'col-name': 'Sample Row' },
  createdAt: '',
  updatedAt: '',
  createdBy: 'tester'
};

vi.mock('../../../api/tablesApi', () => ({
  tablesApi: {
    updateRow: vi.fn(() => Promise.resolve()),
    updateColumn: vi.fn(() => Promise.resolve(column))
  }
}));

// Mock useAIChat — UniversalTable now depends on AIChatContext
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({
  useAIChat: () => ({
    openTaskChat: vi.fn()
  })
}));

describe('UniversalTable', () => {
  it('renders rows from store', () => {
    useTablesStore.setState({
      tables: [table],
      columns: { [table.id]: [column] },
      rows: { [table.id]: [row] },
      activeTableId: table.id,
      loading: false,
      error: null
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <UniversalTable />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('Sample Row')).toBeInTheDocument();
  });
});
