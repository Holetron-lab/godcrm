import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { DocumentCreateResponse } from '../../../../../types/documents.types';

const ctx = vi.hoisted(() => ({
  showCreateDocumentModal: true,
  createDocument: vi.fn<() => Promise<DocumentCreateResponse>>(),
  setShowCreateDocumentModal: vi.fn(),
  setSelectedDocumentId: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { get: vi.fn(async () => ({ success: true, data: { rows: [] } })) },
}));

import { CreateDocumentModal } from '../CreateDocumentModal';

function renderModal() {
  return render(<LanguageProvider><CreateDocumentModal /></LanguageProvider>);
}

describe('CreateDocumentModal', () => {
  it('selects the document ID returned by the creation API', async () => {
    localStorage.setItem('god-crm-language', 'ru');
    ctx.createDocument.mockResolvedValue({
      success: true,
      data: { document_id: 42, table_id: 900, slug: 'new-doc', name: 'New doc' },
      timestamp: '2026-09-15T00:00:00Z',
    });
    renderModal();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'New doc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(ctx.setSelectedDocumentId).toHaveBeenCalledWith(42));
    expect(ctx.setShowCreateDocumentModal).toHaveBeenCalledWith(false);
    expect(ctx.refresh).toHaveBeenCalledOnce();
  });

  it('renders all form copy in English', () => {
    localStorage.setItem('god-crm-language', 'en');
    renderModal();
    expect(screen.getByText('New document')).toBeInTheDocument();
    expect(screen.getByLabelText('Name *')).toHaveAttribute('placeholder', 'Document name');
    expect(screen.getByLabelText('Description')).toHaveAttribute('placeholder', 'Short document description');
    expect(screen.getByLabelText('Category')).toHaveAttribute('placeholder', 'For example: ADR, Spec, Guide');
    expect(screen.getByLabelText('Project (optional)')).toHaveDisplayValue('No project');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});
