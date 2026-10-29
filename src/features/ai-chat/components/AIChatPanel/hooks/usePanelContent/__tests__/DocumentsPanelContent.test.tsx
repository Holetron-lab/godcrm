import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { DocumentsPanelContent } from '../DocumentsPanelContent';
import type { PanelContentDeps } from '../PanelContentTypes';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ success: true, data: { rows: [{ id: 42, data: { name: 'Document body', slug: 'example', table_id: 100545, content_table_id: 100546 } }] } }) } }));
vi.mock('@/features/tables/hooks/useTableColumns', () => ({ useTableColumns: () => ({ data: [] }) }));
vi.mock('../../../hooks/useRowBoundChats', () => ({ useRowBoundChats: () => ({ map: new Map(), refetch: vi.fn() }) }));
vi.mock('@/features/tables/components/modals/AddRowModal', () => ({ AddRowModal: () => null }));
vi.mock('@/features/widgets/components/presets/documents/content/DocumentViewerModal', () => ({ DocumentViewerModal: ({ doc, registryTableId, onClose }: { doc: { name: string; table_id: number }; registryTableId: number; onClose: () => void }) => <div role="dialog" aria-label={doc.name}>{registryTableId}/{doc.table_id}<button onClick={onClose}>Close</button></div> }));
it('opens the document content table with its own registry and closes the viewer', async () => {
  const deps = { favoritesConfig: { documents: { tableId: 2197, tableName: 'Documents' } }, conversations: [], currentConversationId: null, isWideMode: true } as unknown as PanelContentDeps;
  renderWithProviders(<DocumentsPanelContent {...deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Просмотр' }));
  expect(screen.getByRole('dialog', { name: 'Document body' })).toHaveTextContent('2197/100546');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
