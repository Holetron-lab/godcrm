import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

const ctx = vi.hoisted(() => ({
  rightPanelMode: 'settings',
  rightPanelOpen: true,
  selectedItemId: 1,
  items: [{ id: 1, level: 'text', order: 1, content: 'Document body' }],
  selectedDocument: { content_table_id: 42 },
  isCreatingMode: false,
  isReadOnly: false,
  currentLanguage: 'en',
  allAtoms: [],
  setSelectedItemId: vi.fn(),
  setRightPanelMode: vi.fn(),
  setRightPanelOpen: vi.fn(),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../hooks/usePanelEdit', () => ({
  usePanelEdit: () => ({ openPicker: vi.fn(), closePicker: vi.fn(), showAtomPicker: false, atomPickerTargetItemId: null }),
}));
vi.mock('../hooks/useDocumentDelete', () => ({ useDocumentDelete: () => vi.fn() }));
vi.mock('../hooks/useDocumentUpdate', () => ({ useDocumentUpdate: () => vi.fn() }));
vi.mock('../../AtomPicker', () => ({ AtomPicker: () => null }));
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { DocumentsRightPanel } from '../RightPanel';

it('renders element settings in English', () => {
  localStorage.setItem('god-crm-language', 'en');
  render(<LanguageProvider><DocumentsRightPanel /></LanguageProvider>);

  expect(screen.getByText('Element settings')).toBeInTheDocument();
  expect(screen.getByText('Content')).toBeInTheDocument();
  expect(screen.getByLabelText('Element type')).toHaveDisplayValue('TXT Text');
  expect(screen.getByLabelText('Comment')).toHaveAttribute('placeholder', 'Not displayed in the document...');
  expect(screen.getByLabelText('Atom key')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create new atom' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Link existing' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
});
