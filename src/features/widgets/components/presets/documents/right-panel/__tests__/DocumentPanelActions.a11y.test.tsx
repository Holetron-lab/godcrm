import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentItem } from '../../../../../types/documents.types';

const ctx = vi.hoisted(() => ({
  items: [] as DocumentItem[], allAtoms: [], atomsPanelSearchQuery: '',
  atomsPanelTab: 'text-blocks', selectedItemId: null, isReadOnly: false,
  setSelectedItemId: vi.fn(), setRightPanelMode: vi.fn(), setRightPanelOpen: vi.fn(),
  setAtomsPanelTab: vi.fn(), setAtomsPanelSearchQuery: vi.fn(),
  setConvertToAtomItem: vi.fn(), setShowConvertToAtomModal: vi.fn(),
  getNextOrder: () => 1,
  newDocName: 'Imported guide', activePreviewOrder: -1, importTree: [],
  setActivePreviewOrder: vi.fn(), setEditingImportOrder: vi.fn(), setEditingImportData: vi.fn(),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <p>{content}<a href="#reference">Reference</a></p>,
}));
import { AtomsListPanel } from '../AtomsListPanel';
import { SidebarImportView } from '../../sidebar/SidebarImportView';

beforeEach(() => {
  vi.clearAllMocks();
  ctx.items = [{ id: 9, order: 1, level: 'text', content: 'Overview' }];
  ctx.isReadOnly = false; ctx.atomsPanelSearchQuery = ''; ctx.newDocName = 'Imported guide';
});

it('opens the imported title editor with Enter and Space without submitting its form', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  render(<form onSubmit={e => { e.preventDefault(); submit(); }}><SidebarImportView/></form>);
  screen.getByRole('button', { name: 'Редактировать название Imported guide' }).focus();
  await user.keyboard('{Enter} ');
  expect(ctx.setActivePreviewOrder).toHaveBeenCalledTimes(2);
  expect(ctx.setActivePreviewOrder).toHaveBeenLastCalledWith(-1);
  expect(ctx.setEditingImportOrder).toHaveBeenLastCalledWith(-1);
  expect(ctx.setEditingImportData).toHaveBeenLastCalledWith({ title: 'Imported guide' });
  expect(submit).not.toHaveBeenCalled();
});

it('opens item settings with the keyboard and keeps preview links and conversion independent', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><AtomsListPanel/></form>);
  screen.getByRole('button', { name: 'Настройки элемента Overview' }).focus();
  await user.keyboard('{Enter} ');
  expect(ctx.setSelectedItemId).toHaveBeenCalledTimes(2);
  expect(ctx.setSelectedItemId).toHaveBeenLastCalledWith(9);
  expect(ctx.setRightPanelMode).toHaveBeenLastCalledWith('settings');
  expect(ctx.setRightPanelOpen).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole('link', { name: 'Reference' }));
  await user.click(screen.getByRole('button', { name: 'Конвертировать в атом' }));
  expect(ctx.setSelectedItemId).toHaveBeenCalledTimes(2);
  expect(ctx.setConvertToAtomItem).toHaveBeenLastCalledWith(ctx.items[0]);
  expect(ctx.setShowConvertToAtomModal).toHaveBeenLastCalledWith(true);
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button a, button button')).toBeNull();
});

it('keeps panel controls named and form-safe, including tab, close and add actions', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  render(<form onSubmit={e => { e.preventDefault(); submit(); }}><AtomsListPanel/></form>);
  expect(screen.getByRole('textbox', { name: 'Поиск атомов и текстовых блоков' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Текст' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Все атомы' }));
  expect(ctx.setAtomsPanelTab).toHaveBeenCalledWith('all-atoms');
  await user.click(screen.getByRole('button', { name: 'Добавить атом' }));
  expect(ctx.setShowConvertToAtomModal).toHaveBeenCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'Закрыть панель атомов' }));
  expect(ctx.setRightPanelOpen).toHaveBeenCalledWith(false);
  expect(submit).not.toHaveBeenCalled();
});

it('preserves read-only and empty states', () => {
  ctx.isReadOnly = true; ctx.items = []; ctx.newDocName = '';
  render(<><AtomsListPanel/><SidebarImportView/></>);
  expect(screen.getByText('Нет текстовых блоков')).toBeVisible();
  expect(screen.getByText('Загрузите MD файл')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Добавить атом' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Редактировать название/ })).not.toBeInTheDocument();
});
