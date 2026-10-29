import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpandableCard } from './KanbanCard';
import type { ExpandableCardProps } from './kanban-types';
const users = vi.hoisted(() => ({ data: [{ id: 7, name: 'Алиса' }], isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock('@/features/users/hooks/useWorkspaceUsers', () => ({ useWorkspaceUsers: () => users }));
afterEach(() => { cleanup(); users.isLoading = false; users.isError = false; });
const translations = { openFull: 'Открыть', comments: 'Комментарии', chat: 'Чат', attachToMessage: 'Прикрепить', description: 'Описание', save: 'Сохранить', cancel: 'Отмена', noDescription: 'Нет описания', moreFields: 'Ещё', open: 'Открыть' };
function mount(overrides: Partial<ExpandableCardProps> = {}) {
  const edit = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><ExpandableCard item={{ id: 42, data: { title: 'Задача', people: ['7'], assigned_to: ['99'] } }} cardTitleColumn="title"
    assigneeColumn="people" columnsInfo={[{ name: 'people', type: 'user' }, { name: 'assigned_to', type: 'text' }]}
    isExpanded onToggleExpand={vi.fn()} onDoubleClick={vi.fn()} onOpenComments={vi.fn()} onQuickEdit={edit} isDragging={false} translations={translations} {...overrides} /></QueryClientProvider>);
  return edit;
}
it('reads and edits the mapped column instead of the legacy field', () => {
  const edit = mount();
  expect(screen.getByText('Алиса')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Редактировать'));
  fireEvent.click(screen.getByRole('button', { name: 'Убрать Алиса' }));
  expect(edit).toHaveBeenCalledWith('people', null);
});
it('adds a system user to a newly created person column', () => {
  const edit = mount({ item: { id: 42, data: { title: 'Задача' } } });
  fireEvent.click(screen.getByTitle('Назначить ответственного'));
  fireEvent.click(screen.getByTitle('Добавить'));
  fireEvent.click(screen.getByRole('button', { name: 'Алиса' }));
  expect(edit).toHaveBeenCalledWith('people', ['7']);
});
it('keeps relation-backed boards and their labels working', () => {
  const edit = mount({ assigneeColumn: undefined, columnsInfo: [{ name: 'assigned_to', type: 'multi-select', config: { relatedTableId: 10 } }],
    relationData: new Map([['10', new Map([['99', { label: 'Агент' }]])]]) });
  expect(screen.getByText('Агент')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Редактировать'));
  fireEvent.click(screen.getByRole('button', { name: 'Убрать Агент' }));
  expect(edit).toHaveBeenCalledWith('assigned_to', null);
});
it('shows loading and retry on a user lookup failure', () => {
  users.isLoading = true;
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка исполнителей');
  cleanup(); users.isLoading = false; users.isError = true;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(users.refetch).toHaveBeenCalled();
});
it('supports assignee text columns created by the old table template', () => {
  mount({ columnsInfo: [{ name: 'people', type: 'text' }] });
  expect(screen.getByText('Алиса')).toBeInTheDocument();
});
it('retains legacy assignee values when column metadata is absent', () => {
  mount({ assigneeColumn: undefined, columnsInfo: [], item: { id: 42, data: { title: 'Task', assignee: 'Legacy name' } } });
  expect(screen.getByText('Legacy name')).toBeInTheDocument();
});
it('resolves a relation column with direct tableId configuration', () => {
  mount({ columnsInfo: [{ name: 'people', type: 'relation', config: { tableId: 10 } }],
    relationData: new Map([['10', new Map([['7', { label: 'Исполнитель из таблицы' }]])]]) });
  expect(screen.getByText('Исполнитель из таблицы')).toBeInTheDocument();
});

beforeEach(() => localStorage.setItem('god-crm-language', 'ru'));
function render(ui: Parameters<typeof rtlRender>[0]) { return rtlRender(ui, { wrapper: LanguageProvider }); }
