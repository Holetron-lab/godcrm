import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { TableViewWidget } from '../components/presets/TableViewWidget';
import type { Widget } from '../types/widget.types';

const widget = { id: 1, config: {}, preset_name: 'table_view' } as Widget;
const columns = [{ name: 'name', type: 'text', displayName: 'Name', isVisible: false }, { name: 'score', type: 'number', displayName: 'Score' }];
const data = [{ id: 1, name: 'Beta', score: 20 }, { id: 2, name: 'Alpha', score: 3 }];

describe('widget column controls', () => {
  it('keeps table visibility independent and supports hiding every column', () => {
    const { rerender } = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    rerender(<TableViewWidget widget={{ ...widget, config: { hidden_columns: ['name', 'score'] } }} columnsInfo={columns} data={data} />);
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.getByText('Все колонки скрыты. Откройте «Видимость колонок в виджете».')).toBeInTheDocument();
  });
  it('cycles numeric sort ascending, descending, reset without changing the source', () => {
    renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} />);
    const sort = screen.getByRole('button', { name: 'Сортировка: Score' });
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Alpha');
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Beta');
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Beta');
    expect(data[0].name).toBe('Beta');
  });
  it('uses configured image height instead of a fixed thumbnail', () => {
    const { container } = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={[{name:'content',type:'image',config:{image:{rowHeight:180,fit:'contain'}}}]} data={[{content:'/image.png'}]} />);
    expect(container.querySelector('img')).toHaveStyle({ height: '180px', objectFit: 'contain' });
  });
  it('keeps cells locked by default', () => {
    const onCellUpdate = vi.fn();
    renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} onCellUpdate={onCellUpdate} />);
    fireEvent.click(screen.getByText('Beta'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onCellUpdate).not.toHaveBeenCalled();
  });
});

it('retains the draft on failed save and does not invoke row navigation', async () => {
  const column = { id:'name',tableId:'1',name:'name',displayName:'Name',type:'text',config:{},isReadonly:false,isRequired:false,isVisible:true,width:100,orderIndex:0 } as const;
  const onRowClick = vi.fn();
  const onCellUpdate = vi.fn().mockRejectedValue(new Error('Save failed'));
  renderWithProviders(<TableViewWidget widget={{...widget,config:{editable_columns:['name']}}} columnsInfo={[column]} tableColumns={[column]} data={data} onRowClick={onRowClick} onCellUpdate={onCellUpdate} />);
  fireEvent.click(screen.getAllByRole('cell',{name:'Редактировать: Name'})[0]);
  fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Сохранить'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByRole('textbox',{name:'Name'})).toHaveValue('Draft');
  expect(onRowClick).not.toHaveBeenCalled();
});

it('renders canonical content image items with the column height', () => {
  const {container} = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={[{name:'content',type:'content',config:{image:{rowHeight:160}}}]} data={[{content:[{kind:'image',url:'/image.png'}]}]} />);
  expect(container.querySelector('img')).toHaveStyle({height:'160px'});
});

it('keeps public content non-fetching and active columns non-editable', () => {
  const {container} = renderWithProviders(<PublicViewProvider readOnly publicSlug="public">
    <TableViewWidget widget={{...widget,config:{editable_columns:['content']}}} columnsInfo={[{name:'content',type:'content'}]} data={[{content:[{kind:'image',url:'/uploads/private.png'}]}]} onConfigChange={vi.fn()} onCellUpdate={vi.fn()} />
  </PublicViewProvider>);
  expect(container.querySelector('img, video, audio, input')).toBeNull();
  expect(screen.queryByRole('button',{name:/Меню колонки/})).toBeNull();
});
