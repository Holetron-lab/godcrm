import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NumberWidget } from '../components/presets/NumberWidget';
import type { Widget } from '../types/widget.types';

const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null,
  widget_type: 'preset', preset_name: 'number_widget',
  code: null, code_version: 1, title: 'Revenue', description: null, icon: '#',
  config: {}, position: { x: 0, y: 0, w: 4, h: 4 },
  is_visible: true, is_module: false, order_index: 0, created_by: null,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};

const rows = [{ amount: 10, state: 0 }, { data: { amount: 20, state: 1 } }, { amount: 30, state: 0 }];

describe('NumberWidget', () => {
  it.each([
    ['count', '3'], ['sum', '60'], ['avg', '20'], ['min', '10'], ['max', '30'],
  ] as const)('calculates %s for flat and nested row data', (aggregation, expected) => {
    render(<NumberWidget widget={{ ...widget, config: { aggregation, column: 'amount' } }} data={rows} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each(['count', 'sum', 'avg', 'min', 'max'] as const)('renders zero for %s over empty data', aggregation => {
    render(<NumberWidget widget={{ ...widget, config: { aggregation, column: 'amount' } }} data={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('filters by an exact zero value', () => {
    render(<NumberWidget widget={{ ...widget, config: { aggregation: 'sum', column: 'amount', filter: { column: 'state', value: 0 } } }} data={rows} />);
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('filters by a list of values', () => {
    render(<NumberWidget widget={{ ...widget, config: { aggregation: 'sum', column: 'amount', filter: { column: 'state', values: [1] } } }} data={rows} />);
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('keeps prefix, suffix and title', () => {
    render(<NumberWidget widget={{ ...widget, config: { prefix: '$', suffix: ' USD' } }} data={rows} />);
    expect(screen.getByText('$3 USD')).toBeInTheDocument();
    expect(screen.getByText('Revenue #1')).toBeInTheDocument();
  });

  it('treats invalid numeric values as zero', () => {
    render(<NumberWidget widget={{ ...widget, config: { aggregation: 'sum', column: 'amount' } }} data={[{ amount: 'bad' }, { data: { amount: 4 } }]} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
