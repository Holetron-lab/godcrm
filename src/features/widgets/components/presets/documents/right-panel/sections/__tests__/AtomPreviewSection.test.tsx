import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { DocumentItem } from '../../../../../../types/documents.types';
const ctx = vi.hoisted(() => ({
  items: [], allAtoms: [{ id: 42, key: 'old-key' }], isReadOnly: false, currentLanguage: 'en',
  updateAtom: vi.fn(),
}));
const updateItem = vi.hoisted(() => vi.fn());
vi.mock('../../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../../hooks/useDocumentUpdate', () => ({ useDocumentUpdate: () => updateItem }));
import { AtomPreviewSection } from '../AtomPreviewSection';

function renderSection(item: DocumentItem) {
  return render(<LanguageProvider><AtomPreviewSection item={item} tableId={900} onOpenAtomPicker={vi.fn()} /></LanguageProvider>);
}

it.each(['text', 'atom'] as const)('edits the atom key without overwriting the numeric reference (%s)', (level) => {
  localStorage.setItem('god-crm-language', 'ru');
  renderSection({ id: 7, order: 1, level, atom_ref: 42 });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ключ атома' }), { target: { value: 'new-key' } });
  expect(ctx.updateAtom).toHaveBeenLastCalledWith({ atomId: 42, data: { key: 'new-key' } });
  expect(updateItem).not.toHaveBeenCalled();
});

it('renders atom settings and actions in English', () => {
  localStorage.setItem('god-crm-language', 'en');
  renderSection({ id: 7, order: 1, level: 'text' });
  expect(screen.getByText('Atom')).toBeInTheDocument();
  expect(screen.getByLabelText('Atom name')).toHaveAttribute('placeholder', 'Atom name...');
  expect(screen.getByLabelText('Atom comment')).toHaveAttribute('placeholder', 'Description or note...');
  expect(screen.getByRole('button', { name: 'Create new atom' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Link existing' })).toBeInTheDocument();
});
