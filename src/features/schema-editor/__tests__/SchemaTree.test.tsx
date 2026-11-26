import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SchemaTree } from '../components/panels/SchemaTree';
import type { SchemaTreeModel, SchemaTreeOverlay } from '../components/panels/navTreeTypes';
import type { ColumnData, NavTreeNode } from '../types/schema-editor.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));

const t = (key: string) => key;
const column = (id: string, name: string, isPrimaryKey = false): ColumnData =>
  ({ id, name, displayName: name.toUpperCase(), type: 'text', isPrimaryKey, isForeignKey: false, isRequired: false });
const table: NavTreeNode = { id: 'table:5', type: 'table', numericId: 5, name: 'bugs', displayName: 'Bugs', icon: '🐛', children: [], parentId: 'project:1' };
const app: NavTreeNode = { id: 'widget:9', type: 'widget', numericId: 9, name: 'Board', displayName: 'Board', icon: '🧩', children: [], parentId: 'project:1',
  widgetType: 'preset', presetName: 'table_view', mainTableId: 5 };
const project: NavTreeNode = { id: 'project:1', type: 'project', numericId: 1, name: 'qa', displayName: 'QA', icon: '📁', children: [table, app], parentId: null };

// A model built from plain data: no store behind it, every change goes out through a spy.
const model = (expanded: string[] = []): SchemaTreeModel => ({
  isExpanded: (node) => expanded.includes(node.id),
  getVisibility: (node) => (node.type === 'table' ? 'hidden' : 'visible'),
  getTableColumns: (tableId) => (tableId === 5 ? { columns: [column('1', 'id', true), column('2', 'title')], rowsLoading: false } : undefined),
  onToggleExpand: vi.fn(),
  onVisibilityChange: vi.fn(),
  onLoadTableRows: vi.fn(),
});
const renderTree = (m: SchemaTreeModel) => render(
  <SchemaTree nodes={[project]} model={m} t={t} selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={vi.fn()} onToggleProjectSelect={vi.fn()} />
);
const source = (file: string) => readFileSync(`${process.cwd()}/src/features/schema-editor/components/panels/${file}`, 'utf8');

afterEach(() => cleanup());

it('renders from props only: the tree files do not import the schema-editor store', () => {
  for (const file of ['SchemaTree.tsx', 'NavTreeItem.tsx', 'NavTreeColumnRow.tsx']) {
    expect(source(file), file).not.toMatch(/useSchemaEditorStore|store\/schemaEditorStore/);
  }
});

it('shows children and columns from isExpanded and asks to expand through the callback', () => {
  const closed = model();
  renderTree(closed);
  expect(screen.getByRole('button', { name: 'QA' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Bugs' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.expandAll: QA' }));
  expect(closed.onToggleExpand).toHaveBeenCalledWith(project);
  cleanup();

  renderTree(model(['project:1', 'table:5']));
  expect(screen.getByRole('button', { name: 'Bugs' })).toBeInTheDocument();
  expect(screen.getByText('Board')).toBeInTheDocument();
  expect(screen.getByText('TITLE')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'schemaEditor.collapseAll: Bugs' })).toHaveAttribute('aria-expanded', 'true');
});

it('reads visibility from the model and reports the next state through the callback', () => {
  const m = model(['project:1']);
  renderTree(m);
  fireEvent.click(screen.getByTitle('schemaEditor.visibility.hiddenClick'));
  expect(m.onVisibilityChange).toHaveBeenCalledWith(table, 'partial');
  fireEvent.click(screen.getByTitle('schemaEditor.visibility.visibleClick'));
  expect(m.onVisibilityChange).toHaveBeenCalledWith(project, 'hidden');
});

it('asks for table rows when a column preview opens without loaded rows', () => {
  const m = model(['project:1', 'table:5']);
  renderTree(m);
  fireEvent.click(screen.getByRole('button', { name: 'Preview TITLE' }));
  expect(m.onLoadTableRows).toHaveBeenCalledWith(5);
  expect(screen.getByText('No data')).toBeInTheDocument();
});

it('keeps the ⋮ menu and the app row with its main-table menu', () => {
  renderTree(model(['project:1']));
  const menus = screen.getAllByRole('button', { name: 'schemaEditor.navMenu.actions' });
  expect(menus).toHaveLength(3); // project, table, app
  fireEvent.click(menus[2]);
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)[0]).toBe('schemaEditor.navMenu.openWidget');
});

// ADR-207 §2.6 — the install plan reuses the tree and replaces the editor's own row chrome.
it('hands the row chrome to an overlay: plan state and details instead of visibility, selection, settings and ⋮', () => {
  const planned: NavTreeNode = { ...table, id: 'table:plan:sla', numericId: 0, name: 'sla_rules', displayName: 'SLA rules' };
  const overlay: SchemaTreeOverlay = {
    renderState: (node) => (node.type === 'table' ? <span>will change</span> : null),
    renderDetails: (node) => (node.id === 'table:5' ? <p>mapping rows</p> : null),
    rowClassName: (node) => (node.id === 'table:5' ? 'plan-change' : ''),
  };
  render(
    <SchemaTree nodes={[{ ...project, children: [table, planned] }]} model={model(['project:1', 'table:5'])} overlay={overlay} t={t}
      selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={vi.fn()} onToggleProjectSelect={vi.fn()} />
  );
  expect(screen.getAllByText('will change')).toHaveLength(2);
  expect(screen.getByText('mapping rows')).toBeInTheDocument();
  expect(screen.getByText('Bugs').closest('.plan-change')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'schemaEditor.collapseAll: Bugs' })).toHaveAttribute('aria-expanded', 'true');
  // Editor chrome is gone: no visibility toggle, no ⋮ menu, no settings buttons, no column rows, no selection.
  expect(screen.queryByTitle(/schemaEditor\.visibility/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'schemaEditor.navMenu.actions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Bugs' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'QA' })).not.toBeInTheDocument();
  expect(screen.queryByText('TITLE')).not.toBeInTheDocument();
  expect(screen.queryByTitle('common.select')).not.toBeInTheDocument();
  // A node the plan adds has no id yet.
  expect(screen.getByText('sla_rules')).toBeInTheDocument();
  expect(screen.queryByText(/#0/)).not.toBeInTheDocument();
});
