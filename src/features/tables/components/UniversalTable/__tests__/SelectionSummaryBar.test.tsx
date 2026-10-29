import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { SelectionSummaryBar } from '../SelectionSummaryBar';
import type { ServerColumnSummary, TableSummaryState } from '../../../hooks/useTableSummary';
import type { ColumnModel } from '../../../types/table.types';

const column = (id: string, type: ColumnModel['type'], config: ColumnModel['config'] = {}): ColumnModel => ({
  id, tableId: '1', name: `col_${id}`, displayName: `Col ${id}`, type, config,
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
});

const base: ServerColumnSummary = {
  count: 3, countFilled: 3, countEmpty: 0, countUnique: 3, percentFilled: 100,
  numericCount: 0, sum: 0, avg: null, min: null, max: null,
  checked: 0, unchecked: 0, percentChecked: 0,
  dateCount: 0, earliest: null, latest: null, dateRange: null, valueCounts: {},
};

const columns = [column('n', 'number'), column('c', 'checkbox'), column('s', 'select', { options: [{ value: 'a', label: 'Alpha' }] })];

const renderBar = (summary: TableSummaryState) => {
  localStorage.setItem('god-crm-language', 'ru');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <SelectionSummaryBar
          columns={columns}
          rows={[]}
          selectedRowIds={new Set(['1', '2', '3'])}
          selectionSort="default"
          onSortChange={vi.fn()}
          onClearSelection={vi.fn()}
          onSelectAllFiltered={vi.fn()}
          filteredCount={3}
          totalCount={10}
          summary={summary}
        />
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

describe('SelectionSummaryBar (server values)', () => {
  it('renders selection totals from the server even when selected rows are not loaded', () => {
    renderBar({ status: 'ready', data: { total: 3, columns: {
      n: { ...base, numericCount: 3, sum: 600, avg: 200 },
      c: { ...base, count: 3, checked: 2 },
      s: { ...base, valueCounts: { a: 2, b: 1 } },
    } } });
    expect(screen.getByText(/Σ600 μ200/)).toBeInTheDocument();
    expect(screen.getByText(/✓2 ✗1/)).toBeInTheDocument();
    expect(screen.getByText(/Alpha:2 b:1/)).toBeInTheDocument();
  });

  it('shows an explicit unavailable state instead of partial local totals', () => {
    renderBar({ status: 'unavailable', reason: 'Full summary is not available for this data source' });
    expect(screen.getByText('Итоги недоступны')).toBeInTheDocument();
    expect(screen.queryByText(/Σ/)).not.toBeInTheDocument();
  });

  it('shows a loading placeholder while the server computes', () => {
    renderBar({ status: 'loading' });
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
