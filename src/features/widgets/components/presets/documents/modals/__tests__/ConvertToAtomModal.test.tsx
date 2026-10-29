import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const ctx = vi.hoisted(() => ({
  convertToAtomItem: { id: 7, level: 'text', atom_ref: 99, atom_key: 'readable-key', atom_title: 'Title', content: 'Body' },
  items: [], selectedDocumentId: 5, selectedDocument: { content_table_id: 900 }, atomsTableId: 901,
  createAtom: vi.fn(async () => ({ id: 42 })), updateItem: vi.fn(async () => ({})),
  setShowConvertToAtomModal: vi.fn(), setConvertToAtomItem: vi.fn(),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
import { ConvertToAtomModal } from '../ConvertToAtomModal';

it('creates an atom with its text key and stores the returned numeric reference', async () => {
  render(<ConvertToAtomModal />);
  expect(screen.getByDisplayValue('readable-key')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Создать атом' }));
  await waitFor(() => expect(ctx.updateItem).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ atom_ref: 42, level: 'atom' }),
  })));
  expect(ctx.createAtom).toHaveBeenCalledWith(expect.objectContaining({ key: 'readable-key', type: 'reference' }));
});
