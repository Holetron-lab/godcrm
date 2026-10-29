import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { useColumnSummaries } from '../useColumnSummaries';
import type { ServerColumnSummary, TableSummaryState } from '../../../hooks/useTableSummary';
import type { ColumnModel } from '../../../types/table.types';

const column = (id: string, type: ColumnModel['type'], config: ColumnModel['config'] = {}): ColumnModel => ({
  id, tableId: '1', name: `col_${id}`, displayName: id, type, config,
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
});

const base: ServerColumnSummary = {
  count: 4, countFilled: 3, countEmpty: 1, countUnique: 2, percentFilled: 75,
  numericCount: 0, sum: 0, avg: null, min: null, max: null,
  checked: 0, unchecked: 0, percentChecked: 0,
  dateCount: 0, earliest: null, latest: null, dateRange: null, valueCounts: {},
};

function Footer({ summary, columns }: { summary: TableSummaryState; columns: ColumnModel[] }) {
  const nodes = useColumnSummaries(summary, columns, undefined);
  return <>{columns.map(c => <div key={c.id} data-testid={c.id}>{nodes.get(c.id)}</div>)}</>;
}

const renderFooter = (summary: TableSummaryState, columns: ColumnModel[], language = 'ru') => {
  localStorage.setItem('god-crm-language', language);
  return render(<LanguageProvider><Footer summary={summary} columns={columns} /></LanguageProvider>);
};

describe('useColumnSummaries (server values)', () => {
  it('renders number, text, checkbox, date and select totals from the server response', () => {
    const columns = [
      column('n', 'number', { summary: { min: true, max: true, count: true } }),
      column('t', 'text'),
      column('c', 'checkbox'),
      column('d', 'date'),
      column('s', 'select', { options: [{ value: 'a', label: 'Alpha', color: '#ff0000' }] }),
    ];
    renderFooter({
      status: 'ready',
      data: { total: 4, columns: {
        n: { ...base, numericCount: 3, sum: 600, avg: 200, min: 100, max: 300 },
        t: { ...base, countUnique: 2 },
        c: { ...base, checked: 2, unchecked: 1 },
        d: { ...base, dateCount: 2, earliest: '2024-01-01T00:00:00.000Z', latest: '2024-12-31T00:00:00.000Z' },
        s: { ...base, valueCounts: { a: 3, b: 1 } },
      } },
    }, columns);

    expect(screen.getByTestId('n')).toHaveTextContent('600');
    expect(screen.getByTestId('n')).toHaveTextContent('avg:200');
    expect(screen.getByTestId('n')).toHaveTextContent('min:100');
    expect(screen.getByTestId('n')).toHaveTextContent('max:300');
    expect(screen.getByTestId('n')).toHaveTextContent('n:3');
    expect(screen.getByTestId('t')).toHaveTextContent('2 уник.');
    expect(screen.getByTestId('c')).toHaveTextContent('✓ 2');
    expect(screen.getByTestId('c')).toHaveTextContent('✗ 1');
    expect(screen.getByTestId('d')).toHaveTextContent('→');
    expect(screen.getByTestId('s')).toHaveTextContent('Alpha: 3');
    expect(screen.getByTestId('s')).toHaveTextContent('b: 1');
    expect(screen.getAllByText('1 пустых')).toHaveLength(5);
  });

  it('labels counts in the English locale', () => {
    renderFooter({ status: 'ready', data: { total: 4, columns: { t: { ...base, countUnique: 2 }, o: { ...base, countFilled: 3 } } } },
      [column('t', 'text'), column('o', 'url' as ColumnModel['type'])], 'en');
    expect(screen.getByTestId('t')).toHaveTextContent('2 unique');
    expect(screen.getAllByText('1 empty')).toHaveLength(2);
    expect(screen.queryByText(/уник|пустых/)).not.toBeInTheDocument();
  });

  it('shows a dash for a column with no usable values and no empty badge when nothing is empty', () => {
    renderFooter({ status: 'ready', data: { total: 2, columns: { n: { ...base, countEmpty: 0, numericCount: 0 } } } }, [column('n', 'number')]);
    expect(screen.getByTestId('n')).toHaveTextContent('—');
    expect(screen.queryByText(/пустых/)).not.toBeInTheDocument();
  });

  it('shows a loading placeholder instead of page-local totals while the server computes', () => {
    renderFooter({ status: 'loading' }, [column('n', 'number')]);
    expect(screen.getByTestId('n')).toHaveTextContent('…');
    expect(screen.queryByText(/Σ/)).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state when the server cannot summarize', () => {
    renderFooter({ status: 'unavailable', reason: 'Full summary is not available for this data source' }, [column('n', 'number')], 'en');
    expect(screen.getByTestId('n')).toHaveTextContent('Totals unavailable');
    expect(screen.getByTitle('Full summary is not available for this data source')).toBeInTheDocument();
  });
});
