import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SchemaSearch } from '../components/toolbar/SchemaSearch';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import type { TableNodeData } from '../types/schema-editor.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));

const table = (tableId: number, name: string, displayName: string): TableNodeData =>
  ({ tableId, name, displayName, key: name, icon: '📋', projectId: 1, isExternal: false, columns: [], projectName: 'Dev' });

beforeEach(() => {
  useSchemaEditorStore.getState().reset();
  useSchemaEditorStore.setState({ nodes: [
    { id: 'table-1552', type: 'tableNode', position: { x: 0, y: 0 }, data: table(1552, 'bugs', 'Bugs') },
    { id: 'table-1708', type: 'tableNode', position: { x: 0, y: 0 }, data: table(1708, 'tickets', 'Tickets') },
  ] });
});
afterEach(() => cleanup());

it('finds a table by name or #id and focuses it on Enter', () => {
  const focus = vi.fn();
  window.addEventListener('schema-editor:focus-table', ((e: CustomEvent) => focus(e.detail)) as EventListener);
  render(<SchemaSearch />);
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.search.title' }));
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'tick' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByText('Tickets')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '#15' } });
  expect(screen.getByText('Bugs')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(focus).toHaveBeenCalledWith({ tableId: 1552 });
  // the inline input closes after a pick; nothing floats over the toolbar
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'schemaEditor.search.title' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(screen.getByText('schemaEditor.search.noResults')).toBeInTheDocument();
});
