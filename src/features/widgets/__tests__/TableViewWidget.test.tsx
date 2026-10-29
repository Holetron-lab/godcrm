import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as renderComponent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { TableViewWidget } from '../components/presets/TableViewWidget';
import type { Widget } from '../types/widget.types';
import { renderWithProviders } from '@/tests/renderWithProviders';

const render = (element: ReactElement) => renderComponent(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {element}
  </QueryClientProvider>
);

const publicView = vi.hoisted(() => ({ readonly: false }));
vi.mock('@/features/public/PublicViewContext', () => ({ useIsPublicReadOnly: () => publicView.readonly }));
const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null,
  widget_type: 'preset', preset_name: 'table_view',
  code: null, code_version: 1, title: 'Tickets', description: null, icon: '#',
  config: {}, position: { x: 0, y: 0, w: 4, h: 4 },
  is_visible: true, is_module: false, order_index: 0, created_by: null,
  created_at: '', updated_at: '', module_id: null, sidebar_order: null,
  sidebar_icon: null, access_level: null, is_pinned: null,
};
beforeEach(() => { publicView.readonly = false; });

describe('TableViewWidget row contract', () => {
  it.each([{ shelf: 'A-12' }, [{ shelf: 'A-12' }], '{"shelf":"A-12"}'])(
    'renders JSON values using the column preview settings: %j', (value) => {
      render(<TableViewWidget widget={widget}
        columnsInfo={[{ name: 'storage_location', type: 'json', config: { json: { prettyInCell: false, previewLines: 2 } } }]}
        data={[{ storage_location: value }]} />);
      const json = typeof value === 'string' ? value : JSON.stringify(value);
      expect(screen.getByTitle(json)).toHaveStyle({ WebkitLineClamp: '2' });
      expect(screen.getByTitle(json)).toHaveTextContent(json);
      expect(screen.queryByText('[object Object]')).toBeNull();
    }
  );
  it.each([false, true])('renders JSON table mode without edit controls (public: %s)', (readonly) => {
    publicView.readonly = readonly;
    const onRowClick = vi.fn();
    renderWithProviders(<TableViewWidget widget={widget}
      columnsInfo={[{ name: 'storage_location', type: 'json', config: { json: { cellView: 'table' } } }]}
      data={[{ id: 158, storage_location: { shelf: 'A-12' } }]}
      onRowClick={onRowClick} />, { language: 'en' });
    expect(screen.getByRole('table', { name: 'JSON as a table' })).toBeInTheDocument();
    expect(screen.getByText('shelf')).toBeInTheDocument();
    expect(screen.getByText('A-12')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByText('A-12'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
  it.each([null, '', '{invalid', 0, false])('handles empty, malformed and scalar JSON: %j', (value) => {
    render(<TableViewWidget widget={widget}
      columnsInfo={[{ name: 'seo', type: 'json' }]}
      data={[{ seo: value }]} />);
    expect(screen.getByRole('cell')).toHaveTextContent(value === null || value === '' ? '—' : String(value));
  });
  it('opens flat rows with a normalized payload and preserves zero IDs', () => {
    const onRowClick = vi.fn();
    render(<TableViewWidget widget={widget} data={[{ id: 0, name: 'Zero' }]} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Zero'));
    expect(onRowClick).toHaveBeenCalledWith({ id: 0, name: 'Zero', data: { id: 0, name: 'Zero' } });
  });
  it('opens wrapped rows using Enter and Space', () => {
    const onRowClick = vi.fn();
    render(<TableViewWidget widget={widget} data={[{ id: 9, data: { name: 'Wrapped' } }]} onRowClick={onRowClick} />);
    const row = screen.getByRole('row', { name: 'Wrapped' });
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenCalledWith({ id: 9, data: { name: 'Wrapped' } });
  });
  it('supports keyboard activation when only a double-click handler is supplied', () => {
    const onRowDoubleClick = vi.fn();
    render(<TableViewWidget widget={widget} data={[{ id: 1, name: 'Open' }]} onRowDoubleClick={onRowDoubleClick} />);
    fireEvent.keyDown(screen.getByRole('row', { name: 'Open' }), { key: 'Enter' });
    expect(onRowDoubleClick).toHaveBeenCalledTimes(1);
  });
  it('infers boolean cells from flat row values', () => {
    render(<TableViewWidget widget={widget} data={[{ active: true }]} />);
    expect(screen.getByTitle('checkbox')).toBeInTheDocument();
  });
  it('renders wrapped values and retains top-level fallbacks', () => {
    render(<TableViewWidget widget={widget} data={[{ name: 'Fallback', data: { name: null } }]} />);
    expect(screen.getByText('Fallback')).toBeInTheDocument();
  });
  it.each(['image', 'file', 'attachment'])('keeps public %s cells non-fetching', (type) => {
    publicView.readonly = true;
    const { container } = render(<TableViewWidget widget={widget}
      columnsInfo={[{ name: 'asset', type }]}
      data={[{ asset: '/uploads/private.png' }]} />);
    expect(screen.getByText('private.png')).toBeInTheDocument();
    expect(container.querySelector('img, a')).toBeNull();
  });
});
