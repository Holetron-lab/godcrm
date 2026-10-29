import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocumentItem, DocumentRegistryItem } from '../../../../../types/documents.types';

const ctx = vi.hoisted(() => ({
  selectedDocumentId: 7,
  selectedDocument: { content_table_id: 42 },
  currentLanguage: 'en', viewScale: 100, widgetId: 218, projectId: 9, spaceId: 11,
  addItem: vi.fn(async () => ({ id: 99, tableId: 42 })),
  updateItem: vi.fn(async () => ({ success: true })),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('@/shared/hooks/useSystemVariables', () => ({ useSystemVariables: () => ({}) }));
vi.mock('../EditableMarkdownPreview', () => ({ EditableMarkdownPreview: () => null }));
import { DocumentStructure } from '../DocumentStructure';

const item: DocumentItem = { id: 1, level: 'text', order: 10, content: 'Original' };
const document: DocumentRegistryItem = { id: 7, name: 'Doc', slug: 'doc', table_id: 42 };

function renderStructure() {
  render(<DocumentStructure items={[item]} document={document} onSelectItem={vi.fn()} />);
}

describe('DocumentStructure mutation contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('copies content using the addItem item payload', async () => {
    renderStructure();
    fireEvent.click(screen.getByTitle('Меню'));
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    await waitFor(() => expect(ctx.addItem).toHaveBeenCalledWith({
      documentId: 7,
      item: { level: 'text', content_en: 'Original', image_url: undefined, order: 20, is_hidden: false },
    }));
  });

  it('changes level using data and the canonical document table ID', async () => {
    renderStructure();
    fireEvent.click(screen.getByTitle('Изменить тип элемента'));
    fireEvent.click(screen.getByRole('button', { name: 'H2H2' }));
    await waitFor(() => expect(ctx.updateItem).toHaveBeenCalledWith({
      documentId: 7, tableId: 42, itemId: 1, data: { level: 'h2' },
    }));
  });
});
