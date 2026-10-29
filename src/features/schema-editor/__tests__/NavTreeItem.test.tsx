import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NavTreeItem } from '../components/panels/NavTreeItem';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import type { ColumnData, NavTreeNode, TableNodeData } from '../types/schema-editor.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));

const t = (key: string) => key;
const column = (id: string, name: string, isPrimaryKey = false): ColumnData =>
  ({ id, name, displayName: name.toUpperCase(), type: 'text', isPrimaryKey, isForeignKey: false, isRequired: false });
const data: TableNodeData = { tableId: 5, name: 'bugs', displayName: 'Bugs', key: 'bugs', icon: '🐛', projectId: 1, isExternal: false,
  columns: [column('1', 'id', true), column('2', 'title')], rowsPreview: [{ id: 1, title: 'First' }] };
const treeNode: NavTreeNode = { id: 'table:5', type: 'table', numericId: 5, name: 'bugs', displayName: 'Bugs', icon: '🐛', children: [], parentId: null };

const renderItem = () => render(
  <NavTreeItem node={treeNode} depth={1} t={t} selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={vi.fn()} onToggleProjectSelect={vi.fn()} />
);
const listen = (name: string) => {
  const spy = vi.fn();
  window.addEventListener(name, ((e: CustomEvent) => spy(e.detail)) as EventListener);
  return spy;
};

beforeEach(() => {
  useSchemaEditorStore.getState().reset();
  useSchemaEditorStore.setState({ nodes: [{ id: 'table-5', type: 'tableNode', position: { x: 0, y: 0 }, data }] });
});
afterEach(() => cleanup());

it.each(['project', 'folder', 'table'] as const)('puts selection before expansion for a %s', (type) => {
  const node: NavTreeNode = type === 'table' ? treeNode : { ...treeNode, id: `${type}:1`, type, numericId: 1, children: [treeNode] };
  const { container } = render(<NavTreeItem node={node} depth={1} t={t} selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={vi.fn()} onToggleProjectSelect={vi.fn()} />);
  const row = container.firstElementChild?.firstElementChild;
  const buttons = row?.querySelectorAll(':scope > button');
  expect(buttons?.[0].getAttribute('title')).toBe(type === 'table' ? 'common.select' : 'schemaEditor.selection.clickToSelectParent');
  expect(buttons?.[1]).toHaveAttribute('aria-expanded');
});

it('shows a ⋮ menu on the right and opens table settings from the name', () => {
  const edit = listen('schema-editor:edit-table');
  renderItem();
  expect(screen.getByRole('button', { name: 'schemaEditor.navMenu.actions' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bugs' }));
  expect(edit).toHaveBeenCalledWith({ tableId: 5 });
});

it('expands the table into its columns and forwards column actions to the node', () => {
  const action = listen('schema-editor:column-action');
  renderItem();
  expect(screen.queryByText('TITLE')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.expandAll: Bugs' }));
  expect(useSchemaEditorStore.getState().expandedFolders.has('table:5')).toBe(true);
  expect(screen.getByText('TITLE')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'TITLE' }));
  expect(action).toHaveBeenCalledWith({ tableId: 5, columnId: '2', action: 'settings' });
  // Preview reads the rows already loaded on the node.
  fireEvent.click(screen.getByRole('button', { name: 'Preview TITLE' }));
  expect(screen.getByText('First')).toBeInTheDocument();
});

it('holding the emoji opens Move; a short press does not', () => {
  vi.useFakeTimers();
  const move = listen('schema-editor:move-table');
  renderItem();
  const emoji = screen.getByRole('button', { name: 'schemaEditor.navMenu.holdToMove: Bugs' });
  fireEvent.pointerDown(emoji);
  vi.advanceTimersByTime(200);
  fireEvent.pointerUp(emoji);
  vi.advanceTimersByTime(1000);
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerDown(emoji);
  vi.advanceTimersByTime(600);
  expect(move).toHaveBeenCalledWith({ tableId: 5 });
  vi.useRealTimers();
});

it('shows a column type emoji in the tree when the column has no icon of its own', () => {
  renderItem();
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.expandAll: Bugs' }));
  // text columns fall back to the COLUMN_TYPE_METADATA emoji, never the generic pin
  expect(screen.queryByText('📌')).not.toBeInTheDocument();
});

it('gives a table module the table menu of its main table and no relation dot on a plain table', () => {
  const addRow = listen('schema-editor:add-row');
  const widget: NavTreeNode = { id: 'widget:9', type: 'widget', numericId: 9, name: 'Board', displayName: 'Board', icon: '🧩',
    children: [], parentId: null, widgetType: 'preset', presetName: 'table_view', mainTableId: 5 };
  render(
    <NavTreeItem node={widget} depth={1} t={t} selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={vi.fn()} onToggleProjectSelect={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.navMenu.actions' }));
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
  expect(items[0]).toBe('schemaEditor.navMenu.openWidget');
  expect(items).toContain('schemaEditor.tableMenu.addRow');
  expect(items).not.toContain('schemaEditor.navMenu.moveToCenter');
  fireEvent.click(screen.getByRole('menuitem', { name: 'schemaEditor.tableMenu.addRow' }));
  expect(addRow).toHaveBeenCalledWith({ tableId: 5 });
  cleanup();
  renderItem();
  expect(screen.queryByTitle('schemaEditor.connections.existingRelations')).not.toBeInTheDocument();
});
