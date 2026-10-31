import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { DocumentViewerModal } from '../DocumentViewerModal';

vi.mock('@google/model-viewer', () => ({}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: {
  get: vi.fn(async (url: string) => ({ data: url.startsWith('/widgets/')
    ? { widget_id: 218 }
    : { rows: [{ data: { content_en: 'Document body', order: 0 } }] },
  })),
} }));

it.each([
  ['en', 'Open in module', 'Open in documents module'],
  ['ru', 'В модуль', 'Открыть в модуле документов'],
] as const)('localizes the module action in %s and opens the document', async (language, label, title) => {
  const onClose = vi.fn();
  renderWithProviders(<MemoryRouter>
    <Routes>
      <Route path="/" element={<DocumentViewerModal
        doc={{ id: 228774, name: 'ADR-203', slug: 'adr-203', table_id: 100545 }}
        registryTableId={2197} onClose={onClose}
      />} />
      <Route path="/widgets/218" element={<div>Documents module</div>} />
    </Routes>
  </MemoryRouter>, { language });
  expect(await screen.findByText('Document body')).toBeVisible();
  const action = await screen.findByRole('button', { name: label });
  expect(action).toHaveAttribute('title', title);
  fireEvent.click(action);
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.getByText('Documents module')).toBeVisible();
});
