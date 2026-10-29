import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderCellValue } from '../../UniversalTable/renderCellValue';
import type { ColumnModel, DateColumnConfig } from '../../../types/table.types';
import { TableViewWidget } from '@/features/widgets/components/presets/TableViewWidget';
import type { Widget } from '@/features/widgets/types/widget.types';

vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({ language: 'ru', t: (key: string) => key }),
}));

const source: ColumnModel = {
  id: '10', tableId: '1', name: 'starts_at', displayName: 'Начало', type: 'datetime',
  config: { date: { mode: 'datetime', displayFormat: 'datetime_iso' } },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: false,
};
const rollup: ColumnModel = {
  ...source, id: '11', name: 'summary', type: 'rollup', isVisible: true,
  config: { rollup: { fields: [{ id: 'start', label: 'Начало', formula: '{{starts_at}}' }] } },
};

function cell(column: ColumnModel, value: unknown, columns: ColumnModel[] = [source, rollup], rawMode = false) {
  return renderCellValue({ column, columns, value, rowData: { starts_at: value, quantity: 3, price: 10 }, rows: [], rowMutation: {}, rawMode });
}

describe('rollup dates through the table renderer', () => {
  it.each<[DateColumnConfig, string]>([
    [{ mode: 'datetime', displayFormat: 'datetime_iso' }, '2026-11-11 00:00:00'],
    [{ mode: 'datetime', displayFormat: 'time_only' }, '00:00'],
    [{ mode: 'datetime', displayFormat: 'date_short' }, '11.11.2026'],
    [{ mode: 'date', displayFormat: 'default' }, '11 нояб. 2026 г.'],
  ])('uses hidden source column settings %j', (date, expected) => {
    const column = { ...source, config: { date } };
    render(cell(rollup, '2026-11-11T00:00:00', [column, rollup]));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('matches the source cell for the UTC value from the reported bug', () => {
    const value = '2026-11-10T21:00:00.000Z';
    const { container } = render(<>
      <div data-testid="source">{cell(source, value)}</div>
      <div data-testid="rollup">{cell(rollup, value)}</div>
    </>);
    const formatted = screen.getByTestId('source').textContent;
    expect(formatted).not.toBe(value);
    expect(screen.getByTestId('rollup').textContent).toBe(`Начало:${formatted}`);
    expect(container.querySelectorAll('button, input, [tabindex]').length).toBe(0);
  });

  it.each([null, undefined, ''])('keeps empty dates as a dash: %j', value => {
    render(cell(rollup, value));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('preserves raw mode', () => {
    render(cell(rollup, '2026-11-10T21:00:00.000Z', [source, rollup], true));
    expect(screen.getByText('2026-11-10T21:00:00.000Z')).toBeInTheDocument();
  });

  it('preserves numeric formulas, zero, and text that resembles a date', () => {
    const column = { ...rollup, config: { rollup: { fields: [
      { id: 'total', label: 'Total', formula: '{{quantity}} * {{price}}', prefix: '$' },
      { id: 'zero', label: 'Zero', formula: '{{quantity}} - 3' },
      { id: 'text', label: 'Text', formula: '{{starts_at}}' },
    ] } } };
    render(cell(column, '2026-11-10T21:00:00.000Z', [{ ...source, type: 'text' }, column]));
    expect(screen.getByText('$30')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2026-11-10T21:00:00.000Z')).toBeInTheDocument();
  });

  it('keeps date-only values out of arithmetic evaluation and retains affixes', () => {
    const column = { ...source, type: 'date' as const, config: { date: { displayFormat: 'iso_date' } } };
    const summary = { ...rollup, config: { rollup: { fields: [
      { id: 'start', label: 'Начало', formula: '{{starts_at}}', prefix: 'с ', suffix: ' включительно' },
    ] } } };
    const { container } = render(cell(summary, '2026-11-11', [column, summary]));
    expect(container.textContent).toBe('Начало:с 2026-11-11 включительно');
  });

  it('updates formatting when source settings change', () => {
    const { rerender } = render(cell(rollup, '2026-11-11T00:00:00'));
    expect(screen.getByText('2026-11-11 00:00:00')).toBeInTheDocument();
    rerender(cell(rollup, '2026-11-11T00:00:00', [{ ...source, config: { date: { displayFormat: 'time_only' } } }, rollup]));
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-11 00:00:00')).not.toBeInTheDocument();
  });

  it('shows invalid dates through the same renderer', () => {
    render(cell(rollup, 'not-a-date'));
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
  });

  it('keeps the existing fallback when source metadata is unavailable', () => {
    render(cell(rollup, '2026-11-10T21:00:00.000Z', []));
    expect(screen.getByText('2026-11-10T21:00:00.000Z')).toBeInTheDocument();
  });
});

it('renders dates and rollups identically in a widget, including hidden source columns', () => {
  const widget: Widget = {
    id: 1, dashboard_id: 1, source_widget_id: null, widget_type: 'preset', preset_name: 'table_view',
    code: null, code_version: 1, title: 'Акция и даты', description: null, icon: '#',
    config: {}, position: { x: 0, y: 0, w: 4, h: 4 }, is_visible: true, is_module: false,
    order_index: 0, created_by: null, created_at: '', updated_at: '', module_id: null,
    sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
  };
  const data = [{ id: 1, starts_at: '2026-11-11T00:00:00' }];
  const { rerender } = render(<TableViewWidget widget={widget} data={data} columnsInfo={[{ ...source, isVisible: true }, rollup]} />);
  expect(screen.getAllByText('2026-11-11 00:00:00')).toHaveLength(2);
  rerender(<TableViewWidget widget={widget} data={data} columnsInfo={[source, rollup]} />);
  expect(screen.getAllByText('2026-11-11 00:00:00')).toHaveLength(1);
  expect(screen.getByRole('cell')).toHaveTextContent('Начало:2026-11-11 00:00:00');
});
