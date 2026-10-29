import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const ctx = vi.hoisted(() => ({
  items: [], allAtoms: [{ id: 42, key: 'old-key' }], isReadOnly: false, currentLanguage: 'en',
  updateAtom: vi.fn(),
}));
const updateItem = vi.hoisted(() => vi.fn());
vi.mock('../../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../../hooks/useDocumentUpdate', () => ({ useDocumentUpdate: () => updateItem }));
import { AtomPreviewSection } from '../AtomPreviewSection';

it.each(['text', 'atom'] as const)('edits the atom key without overwriting the numeric reference (%s)', (level) => {
  render(<AtomPreviewSection item={{ id: 7, order: 1, level, atom_ref: 42 }} tableId={900} onOpenAtomPicker={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Ключ атома' }), { target: { value: 'new-key' } });
  expect(ctx.updateAtom).toHaveBeenLastCalledWith({ atomId: 42, data: { key: 'new-key' } });
  expect(updateItem).not.toHaveBeenCalled();
});
