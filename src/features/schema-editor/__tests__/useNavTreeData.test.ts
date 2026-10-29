import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNavTreeData } from '../components/panels/useNavTreeData';
import { useSchemaEditorStore } from '../store/schemaEditorStore';
import type { NavTreeNode } from '../types/schema-editor.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

const table = (id: number, parentId: string): NavTreeNode =>
  ({ id: `table:${id}`, type: 'table', numericId: id, name: `t${id}`, icon: '🔗', children: [], parentId });

beforeEach(() => useSchemaEditorStore.getState().reset());

it('marks data-source tables under the virtual External folder as external even when they have relations', () => {
  const external = { id: 'virtual:external:1', type: 'folder' as const, numericId: 0, name: 'External', icon: '', parentId: 'project:1', children: [table(10, 'virtual:external:1')] };
  const internal = { id: 'virtual:internal:1', type: 'folder' as const, numericId: 0, name: 'Internal', icon: '', parentId: 'project:1', children: [table(20, 'virtual:internal:1')] };
  useSchemaEditorStore.setState({
    navTree: [{ id: 'project:1', type: 'project', numericId: 1, name: 'P', icon: '', parentId: null, children: [external, internal] }],
    edges: [
      { id: 'e1', source: 'table-10', target: 'table-20', sourceColumn: 'a', targetColumn: 'id', sourceTableId: 10, targetTableId: 20, type: 'relation' },
    ] as never,
  });
  const { result } = renderHook(() => useNavTreeData());
  const [project] = result.current.navTree;
  const ext = project.children[0].children[0];
  const int = project.children[1].children[0];
  expect(ext).toMatchObject({ numericId: 10, hasEdge: true, isExternal: true });
  expect(int).toMatchObject({ numericId: 20, hasEdge: true });
  expect(int.isExternal).toBeFalsy();
});
