import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ProjectBoundaries } from '../components/layers/ProjectBoundaries';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import type { TableNode } from '../types/schema-editor.types';

vi.mock('@xyflow/react', () => ({ useViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
afterEach(cleanup);

it('keeps the project label and outline above every visible widget strip, including after hiding them', () => {
  useSchemaEditorStore.getState().reset();
  const node: TableNode = { id: 'table-1', type: 'tableNode', position: { x: 100, y: 100 },
    measured: { width: 360, height: 200 }, data: { tableId: 1, name: 'table', displayName: 'Table', key: 'table',
      icon: '', projectId: 1, isExternal: false, columns: [], widgets: [
        { widgetId: 1, name: 'One', icon: '' }, { widgetId: 2, name: 'Two', icon: '' },
      ] } };
  const { container } = render(<ProjectBoundaries nodes={[node]} projectColors={{ 1: '#123456' }} />);
  // Two strips protrude by 42px (28px content + 1px border - 8px tuck each).
  expect(container.querySelector('clipPath path')?.getAttribute('d')).toContain('M 80 22');
  expect(container.querySelector('text')).toHaveAttribute('y', '36');
  act(() => useSchemaEditorStore.getState().toggleWidgets());
  expect(container.querySelector('clipPath path')?.getAttribute('d')).toContain('M 80 64');
  expect(container.querySelector('text')).toHaveAttribute('y', '78');
});
