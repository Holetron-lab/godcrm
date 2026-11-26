import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { DocumentRowAtom } from '../DocumentRowAtom';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/features/widgets/components/presets/documents/content/useInView', () => ({
  useInView: () => ({ ref: vi.fn(), isInView: true }),
}));
vi.mock('@/features/widgets/components/presets/documents/content/DocumentTileView', () => ({
  DocumentTileView: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>Open document</button>,
}));
vi.mock('@/features/widgets/components/presets/documents/content/DocumentViewerModal', () => ({
  DocumentViewerModal: ({ widgetId }: { widgetId?: number }) => <div>viewer-widget:{widgetId ?? 'missing'}</div>,
}));

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset().mockImplementation(async (path: string) => {
    if (path === '/tables/2709/rows/269511') return {
      row: { id: 269511, data: { name: 'Document', slug: 'document', table_id: 101205, widget_id: 134 } },
    };
    if (path === '/tables/2709/columns') return { data: [] };
    return { data: { rows: [] } };
  });
});

it('opens the document through the widget stored on its registry card', async () => {
  renderWithProviders(<DocumentRowAtom
    tableId={2709} rowId={269511}
    rowReference={{ table_id: 2709, row_id: 269511, table_name: 'Documents' }}
    onOpenDetail={vi.fn()} onOpenEdit={vi.fn()} onOpenTaskChat={vi.fn()} onAttachToMessage={vi.fn()}
  />);

  fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
  expect(screen.getByText('viewer-widget:134')).toBeVisible();
});
