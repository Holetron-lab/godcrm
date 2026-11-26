import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DocumentRegistryItem } from '../../../../../types/documents.types';
import { useSidebarFilter } from '../hooks/useSidebarFilter';

const mocks = vi.hoisted(() => ({
  ctx: {
    documents: [] as DocumentRegistryItem[],
    searchQuery: '',
    statusFilter: 'all',
    resolveStatus: () => undefined,
  },
}));

vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => mocks.ctx }));

beforeEach(() => {
  mocks.ctx.documents = [
    { id: 1, name: 'Русский документ', slug: 'named', table_id: 101 },
    { id: 2, description: 'Тоже русский текст', slug: 'unnamed', table_id: 102 } as DocumentRegistryItem,
  ];
  mocks.ctx.searchQuery = 'рус';
});

it('searches Russian text when a registry row has no name', () => {
  const { result } = renderHook(() => useSidebarFilter());

  expect(result.current.map(doc => doc.id)).toEqual([1, 2]);
});
