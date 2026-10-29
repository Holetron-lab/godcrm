import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ColumnHeader } from '../ColumnHeader';
import { createMockColumn } from './columnSettingsTestUtils';
import { ColumnDragContext } from '../DraggableColumnHeader';

beforeEach(() => localStorage.setItem('god-crm-language', 'ru'));

it('opens settings from the name and menu while keeping the right sort arrow independent', async () => {
  const user = userEvent.setup();
  const settings = vi.fn();
  const sort = vi.fn();
  render(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={settings} onSort={sort} /></LanguageProvider>);
  const name = screen.getByRole('button', { name: 'Email' });
  await user.click(name);
  expect(settings).toHaveBeenCalledOnce();
  expect(sort).not.toHaveBeenCalled();
  name.focus();
  await user.keyboard('{Enter}');
  expect(settings).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'Сортировать по Email' }));
  expect(sort).toHaveBeenCalledOnce();
  const menu = screen.getByRole('button', { name: 'Действия столбца Email' });
  menu.focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('menuitem', { name: 'Настройки' }));
  expect(settings).toHaveBeenCalledTimes(3);
  expect(sort).toHaveBeenCalledOnce();
});

it('hides management actions for restricted users but keeps sorting', async () => {
  const user = userEvent.setup();
  const settings = vi.fn();
  const sort = vi.fn();
  render(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={settings} onSort={sort} disableSettings /></LanguageProvider>);
  expect(screen.queryByRole('button', { name: 'Действия столбца Email' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
  await user.click(screen.getByText('Email', { exact: true }));
  expect(settings).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Сортировать по Email' }));
  expect(sort).toHaveBeenCalledOnce();
});

it('starts dragging only from the emoji', async () => {
  const user = userEvent.setup();
  const drag = vi.fn();
  render(<LanguageProvider><ColumnDragContext.Provider value={{ attributes: { role: 'button', tabIndex: 0, 'aria-disabled': false, 'aria-pressed': false, 'aria-roledescription': 'sortable', 'aria-describedby': 'drag-help' }, listeners: { onPointerDown: drag }, setActivatorNodeRef: vi.fn() }}>
    <ColumnHeader column={createMockColumn()} onOpenSettings={vi.fn()} onSort={vi.fn()} />
  </ColumnDragContext.Provider></LanguageProvider>);
  await user.click(screen.getByRole('button', { name: 'Сортировать по Email' }));
  await user.click(screen.getByRole('button', { name: 'Email' }));
  expect(drag).not.toHaveBeenCalled();
  const emoji = screen.getByRole('button', { name: 'Переместить столбец Email' });
  expect(emoji).toHaveTextContent('📧');
  await user.click(emoji);
  expect(drag).toHaveBeenCalledOnce();
});

it('keeps sorting and settings available when the name is hidden', async () => {
  const user = userEvent.setup();
  const sort = vi.fn();
  render(<LanguageProvider><ColumnHeader column={createMockColumn({ config: { appearance: { showHeader: false } } })} onOpenSettings={vi.fn()} onSort={sort} /></LanguageProvider>);
  expect(screen.queryByText('Email', { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Сортировать по Email' }));
  expect(sort).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Действия столбца Email' })).toBeInTheDocument();
});

it('exposes hide / search / group / read-only / delete shortcuts in the menu and fires each handler once', async () => {
  const user = userEvent.setup();
  const handlers = { onHide: vi.fn(), onSearchHere: vi.fn(), onGroupBy: vi.fn(), onToggleLock: vi.fn(), onDelete: vi.fn() };
  render(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={vi.fn()} {...handlers} /></LanguageProvider>);
  const openMenu = async () => { await user.click(screen.getByRole('button', { name: 'Действия столбца Email' })); };
  for (const [name, handler] of [
    ['Скрыть столбец', handlers.onHide],
    ['Искать в этом столбце', handlers.onSearchHere],
    ['Группировать по столбцу', handlers.onGroupBy],
    ['Только чтение', handlers.onToggleLock],
    ['Удалить столбец', handlers.onDelete],
  ] as const) {
    await openMenu();
    await user.click(screen.getByRole('menuitem', { name }));
    expect(handler).toHaveBeenCalledOnce();
  }
  expect(Object.values(handlers).map(fn => fn.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
});

it('groups move and add-column into icon flyouts and passes the chosen side', async () => {
  const user = userEvent.setup();
  const addColumn = vi.fn();
  const moveLeft = vi.fn();
  render(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={vi.fn()} onMoveLeft={moveLeft} onAddColumn={addColumn} /></LanguageProvider>);
  await user.click(screen.getByRole('button', { name: 'Действия столбца Email' }));
  for (const name of ['Переместить столбец', 'Добавить столбец']) {
    expect(screen.getByRole('menuitem', { name }).querySelector('svg')).not.toBeNull();
  }
  expect(screen.queryByRole('menuitem', { name: 'Добавить справа' })).not.toBeInTheDocument();
  screen.getByRole('menuitem', { name: 'Добавить столбец' }).focus();
  await user.keyboard('{ArrowRight}');
  (await screen.findByRole('menuitem', { name: 'Добавить справа' })).focus();
  await user.keyboard('{Enter}');
  expect(addColumn).toHaveBeenCalledExactlyOnceWith('right');
  expect(moveLeft).not.toHaveBeenCalled();
});

it('labels the shortcuts by state and omits the ones without a handler', async () => {
  const user = userEvent.setup();
  render(<LanguageProvider><ColumnHeader column={createMockColumn({ isReadonly: true })} onOpenSettings={vi.fn()} onSearchHere={vi.fn()} isSearchScoped onGroupBy={vi.fn()} isGrouped onToggleLock={vi.fn()} /></LanguageProvider>);
  await user.click(screen.getByRole('button', { name: 'Действия столбца Email' }));
  expect(screen.getByRole('menuitem', { name: 'Искать во всех столбцах' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Убрать группировку' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Разрешить редактирование' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Скрыть столбец' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Удалить столбец' })).not.toBeInTheDocument();
});

it('hides the idle sort arrow until the header is hovered, but keeps an active sort visible', () => {
  const { rerender } = render(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={vi.fn()} onSort={vi.fn()} /></LanguageProvider>);
  const idle = screen.getByRole('button', { name: 'Сортировать по Email' });
  expect(idle.className).toContain('opacity-0');
  expect(idle.className).toContain('group-hover:opacity-100');
  expect(idle.className).toContain('focus-visible:opacity-100');
  rerender(<LanguageProvider><ColumnHeader column={createMockColumn()} onOpenSettings={vi.fn()} onSort={vi.fn()} sortDirection="asc" /></LanguageProvider>);
  const active = screen.getByRole('button', { name: 'Сортировать по Email' });
  expect(active.className).not.toContain('opacity-0');
});
