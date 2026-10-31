import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { TableViewWidget, type ColumnInfo } from '../components/presets/TableViewWidget';
import { WidgetColumnVisibility } from '../components/presets/WidgetColumnVisibility';
import { WidgetTableLink } from '../components/presets/WidgetTableLink';
import type { Widget } from '../types/widget.types';
import type { ColumnModel } from '@/features/tables/types/table.types';

const widget = { id: 1, config: {}, preset_name: 'table_view' } as Widget;
const columns = [{ name: 'name', type: 'text', displayName: 'Name', isVisible: false }, { name: 'score', type: 'number', displayName: 'Score' }];
const data = [{ id: 1, name: 'Beta', score: 20 }, { id: 2, name: 'Alpha', score: 3 }];

afterEach(() => { vi.restoreAllMocks(); });

describe('widget column controls', () => {
  it('inherits table visibility and supports hiding every widget column', () => {
    const { rerender } = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} />);
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.getByText('Score')).toBeInTheDocument();
    rerender(<TableViewWidget widget={{ ...widget, config: { hidden_columns: ['name', 'score'] } }} columnsInfo={columns} data={data} />);
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.getByText('Все колонки скрыты. Откройте «Видимость колонок в виджете».')).toBeInTheDocument();
  });
  it('temporarily expands table-hidden and widget-hidden columns from the edit-mode rail', async () => {
    const props = { widget: { ...widget, config: { hidden_columns: ['score'] } }, columnsInfo: columns, data };
    const { rerender } = renderWithProviders(<TableViewWidget {...props} />);
    expect(screen.queryByRole('button', { name: /скрытых столбцов/ })).toBeNull();
    rerender(<TableViewWidget {...props} isEditMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Показать 2 скрытых столбцов' }));
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть столбцы' }));
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.queryByText('Score')).toBeNull();
    rerender(<TableViewWidget {...props} isEditMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Показать 2 скрытых столбцов' }));
    rerender(<TableViewWidget {...props} />);
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.queryByText('Score')).toBeNull();
  });
  it('mirrors row colors and column appearance from the source table', () => {
    const appearanceColumns: ColumnInfo[] = [
      { name: 'row_color', type: 'color', config: { color: { applyToRow: true, rowColorOpacity: 0.15 } } },
      { name: 'score', type: 'number', displayName: 'Score', config: { appearance: {
        columnColor: '#112233', textColor: '#445566', fontFamily: 'monospace', fontSize: '13px',
        fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline', align: 'right',
        indicator: { type: 'emoji' as const, value: '★', color: '#abcdef' },
      } } },
    ];
    renderWithProviders(<TableViewWidget widget={widget} columnsInfo={appearanceColumns} data={[{ id: 1, row_color: '#22c55e', score: 20 }]} />);
    expect(screen.getByRole('row', { name: '#22c55e 20' })).toHaveStyle({ backgroundColor: '#22c55e26' });
    expect(screen.getByText('Score').closest('th')).toHaveStyle({
      background: 'linear-gradient(to right, #11223340, #11223325)', borderLeft: '3px solid #112233',
    });
    expect(screen.getByText('★')).toHaveStyle({ color: '#abcdef' });
    expect(screen.getByRole('cell', { name: '20' })).toHaveStyle({
      backgroundColor: '#11223310', color: '#445566', fontFamily: 'monospace', fontSize: '13px',
      fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline', textAlign: 'right',
    });
  });
  it('cycles numeric sort ascending, descending, reset without changing the source', () => {
    renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} isEditMode />);
    const sort = screen.getByRole('button', { name: 'Сортировка: Score' });
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('3');
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('20');
    fireEvent.click(sort);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('20');
    expect(data[0].name).toBe('Beta');
  });
  it('shows vertical column controls only in edit mode and removes an open menu on exit', async () => {
    const props = { widget, columnsInfo: columns, data, onConfigChange: vi.fn() };
    const { rerender } = renderWithProviders(<TableViewWidget {...props} />);
    expect(screen.queryByRole('button', { name: /Сортировка:|Меню колонки:/ })).toBeNull();
    rerender(<TableViewWidget {...props} isEditMode />);
    const menu = screen.getByRole('button', { name: 'Меню колонки: Score' });
    expect(menu.querySelector('.lucide-ellipsis-vertical')).not.toBeNull();
    await userEvent.click(menu);
    expect(screen.getByRole('menuitem', { name: 'Скрыть в виджете' })).toBeVisible();
    rerender(<TableViewWidget {...props} />);
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.queryByRole('button', { name: /Сортировка:|Меню колонки:/ })).toBeNull();
    expect(props.onConfigChange).not.toHaveBeenCalled();
  });
  it('uses configured image height instead of a fixed thumbnail', () => {
    const { container } = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={[{name:'content',type:'image',config:{image:{rowHeight:180,fit:'contain'}}}]} data={[{content:'/image.png'}]} />);
    expect(container.querySelector('img')).toHaveStyle({ height: '180px', objectFit: 'contain' });
  });
  it('keeps cells locked by default', () => {
    const onCellUpdate = vi.fn();
    renderWithProviders(<TableViewWidget widget={widget} columnsInfo={columns} data={data} onCellUpdate={onCellUpdate} />);
    fireEvent.click(screen.getByText('20'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onCellUpdate).not.toHaveBeenCalled();
  });
  it('localizes the controls and matches the universal table link and header sizing', async () => {
    renderWithProviders(<MemoryRouter>
      <WidgetTableLink tableId={123} />
      <WidgetColumnVisibility columns={columns} config={{}} onChange={vi.fn()} />
      <TableViewWidget widget={widget} columnsInfo={columns} data={data} isEditMode onConfigChange={vi.fn()} />
    </MemoryRouter>, { language: 'en' });
    const link = screen.getByRole('link', { name: 'Open table' });
    expect(link).toHaveAttribute('href', '/tables/123');
    expect(link.querySelector('.lucide-table-2')).not.toBeNull();
    expect(screen.getByText('Score').closest('th')).toHaveClass('px-3', 'py-1');
    expect(screen.getByRole('button', { name: 'Sort: Score' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Widget column visibility' }));
    expect(screen.getByRole('group', { name: 'Widget column visibility' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Column menu: Score' }));
    expect(screen.getByRole('menuitem', { name: 'Hide in widget' })).toBeVisible();
  });
});

it('retains the draft on failed save and does not invoke row navigation', async () => {
  const column = { id:'name',tableId:'1',name:'name',displayName:'Name',type:'text',config:{},isReadonly:false,isRequired:false,isVisible:true,width:100,orderIndex:0 } as const;
  const onRowClick = vi.fn();
  const onCellUpdate = vi.fn().mockRejectedValue(new Error('Save failed'));
  renderWithProviders(<TableViewWidget widget={{...widget,config:{editable_columns:['name']}}} columnsInfo={[column]} tableColumns={[column]} data={data} onRowClick={onRowClick} onCellUpdate={onCellUpdate} />);
  fireEvent.click(screen.getAllByRole('cell',{name:'Редактировать: Name'})[0]);
  fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Draft'}});
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Name'}),{key:'Enter',shiftKey:true});
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByRole('textbox',{name:'Name'})).toHaveValue('Draft');
  expect(onRowClick).not.toHaveBeenCalled();
});

it('cancels text editing with Escape without saving and restores cell focus', async () => {
  const column: ColumnModel = { id:'name',tableId:'1',name:'name',displayName:'Name',type:'text',config:{},isReadonly:false,isRequired:false,isVisible:true,width:200,orderIndex:0 };
  const onCellUpdate = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<TableViewWidget widget={{...widget,config:{editable_columns:['name']}}} columnsInfo={[column]} tableColumns={[column]} data={data} onCellUpdate={onCellUpdate} />);
  const cell = screen.getAllByRole('cell',{name:'Редактировать: Name'})[0];
  await userEvent.click(cell);
  await userEvent.clear(screen.getByRole('textbox',{name:'Name'}));
  await userEvent.type(screen.getByRole('textbox',{name:'Name'}), 'Discard me');
  await userEvent.keyboard('{Escape}');
  expect(onCellUpdate).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(cell).toHaveTextContent('Beta');
  expect(cell).toHaveFocus();
});

it('uses the universal table select editor for an active column', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 60, 280, 40));
  const column: ColumnModel = { id:'status',tableId:'1',name:'status',displayName:'Статус',type:'select',config:{options:[{value:'review',label:'Требует сверки'}]},isReadonly:false,isRequired:false,isVisible:true,width:100,orderIndex:0 };
  const onCellUpdate = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<TableViewWidget widget={{...widget,config:{editable_columns:['status']}}} columnsInfo={[column]} tableColumns={[column]} data={[{id:1,status:'review'}]} onCellUpdate={onCellUpdate} />);
  fireEvent.click(screen.getByRole('cell',{name:'Редактировать: Статус'}));
  expect(await screen.findByRole('textbox',{name:'Поиск опций'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Сохранить'})).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:/Требует сверки/}));
  expect(onCellUpdate).toHaveBeenCalledWith('1','status','review');
});

describe('rollup source editing', () => {
  const sourceColumns: ColumnModel[] = [
    { id:'status',tableId:'1',name:'status',displayName:'Статус',type:'select',config:{options:[{value:'review',label:'Требует сверки'}]},isReadonly:false,isRequired:false,isVisible:false,width:100,orderIndex:0 },
    { id:'name',tableId:'1',name:'name',displayName:'Name',type:'text',config:{},isReadonly:false,isRequired:false,isVisible:false,width:100,orderIndex:1 },
    { id:'summary',tableId:'1',name:'summary',displayName:'Сводка',type:'rollup',config:{rollup:{fields:[
      {id:'status',label:'Статус',formula:'{{status}}'},
      {id:'name',label:'Name',formula:'{{name}}'},
    ]}},isReadonly:false,isRequired:false,isVisible:true,width:240,orderIndex:2 },
  ];
  const props = {
    widget:{...widget,config:{visible_columns:['summary'],editable_columns:['status','name']}},
    columnsInfo:sourceColumns,
    tableColumns:sourceColumns,
    data:[{id:1,status:'review',name:'Beta'}],
  };

  it('retains mouse double-click activation without opening on the first click', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 60, 280, 40));
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TableViewWidget {...props} onCellUpdate={onCellUpdate} />);
    const source = screen.getByRole('button', { name: /Статус/ });
    await userEvent.click(source);
    expect(screen.queryByRole('textbox', { name: 'Поиск опций' })).toBeNull();
    await userEvent.dblClick(source);
    expect(await screen.findByRole('textbox', { name: 'Поиск опций' })).toHaveFocus();
    expect(onCellUpdate).not.toHaveBeenCalled();
  });

  it('opens the source select editor on double click and saves the source column', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 60, 280, 40));
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TableViewWidget {...props} onCellUpdate={onCellUpdate} />);
    fireEvent.doubleClick(screen.getByText('review'));
    expect(await screen.findByRole('textbox',{name:'Поиск опций'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:/Требует сверки/}));
    expect(onCellUpdate).toHaveBeenCalledWith('1','status','review');
  });

  it('opens the source text editor on double click and saves the source column', () => {
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TableViewWidget {...props} onCellUpdate={onCellUpdate} />);
    fireEvent.doubleClick(screen.getByText('Beta'));
    const editor = screen.getByRole('textbox',{name:'Name'});
    expect(editor.tagName).toBe('TEXTAREA');
    fireEvent.change(editor,{target:{value:'Gamma'}});
    fireEvent.keyDown(editor,{key:'Enter',shiftKey:true});
    expect(onCellUpdate).toHaveBeenCalledWith('1','name','Gamma');
  });

  it('opens both sources from the keyboard and restores source focus after Escape', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 60, 280, 40));
    const onCellUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TableViewWidget {...props} onCellUpdate={onCellUpdate} />);
    const selectSource = screen.getByRole('button', { name: /Статус/ });
    expect(screen.getByRole('button', { name: /Name/ })).toBeInTheDocument();

    await userEvent.tab();
    await userEvent.tab();
    expect(selectSource).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const selectEditor = await screen.findByRole('textbox', { name: 'Поиск опций' });
    expect(selectEditor).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onCellUpdate).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Статус/ })).toHaveFocus();

    await userEvent.tab();
    const textSource = screen.getByRole('button', { name: /Name/ });
    expect(textSource).toHaveFocus();
    await userEvent.keyboard(' ');
    const editor = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Discard me');
    await userEvent.keyboard('{Escape}');
    expect(onCellUpdate).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Name/ })).toHaveFocus();
    expect(textSource).toHaveTextContent('Beta');
  });
});

it('renders canonical content image items with the column height', () => {
  const {container} = renderWithProviders(<TableViewWidget widget={widget} columnsInfo={[{name:'content',type:'content',config:{image:{rowHeight:160}}}]} data={[{content:[{kind:'image',url:'/image.png'}]}]} />);
  expect(container.querySelector('img')).toHaveStyle({height:'160px'});
});

it('keeps public content non-fetching and active columns non-editable', () => {
  const {container} = renderWithProviders(<PublicViewProvider readOnly publicSlug="public">
    <TableViewWidget isEditMode widget={{...widget,config:{editable_columns:['content']}}} columnsInfo={[{name:'content',type:'content'}]} data={[{content:[{kind:'image',url:'/uploads/private.png'}]}]} onConfigChange={vi.fn()} onCellUpdate={vi.fn()} />
  </PublicViewProvider>);
  expect(container.querySelector('img, video, audio, input')).toBeNull();
  expect(screen.queryByRole('button',{name:/Меню колонки/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Сортировка:/})).toBeNull();
});
