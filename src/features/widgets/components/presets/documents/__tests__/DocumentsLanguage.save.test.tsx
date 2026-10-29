import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DocumentsContext, type DocumentsContextValue } from '../DocumentsContext';
import { DocumentsContent } from '../DocumentsContent';
import { ToolbarLanguageSelector } from '../toolbar/ToolbarLanguageSelector';
import { useDocumentsState } from '../context/useDocumentsState';
import { useInlineEditState } from '../context/useInlineEditState';
import type { DocumentItem, DocumentsWidgetConfig } from '../../../../types/documents.types';
import type { DocumentPagesProps } from '../content/DocumentPages';

vi.mock('@/shared/hooks/useMediaQuery', () => ({ useIsMobile: () => false, useIsTablet: () => false, useBreakpoint: () => 'desktop' }));
vi.mock('@/shared/hooks/useSystemVariables', () => ({ useSystemVariables: () => ({}) }));
vi.mock('../content/DocumentPages', () => ({
  DocumentPages: ({ items, renderItemContent }: DocumentPagesProps) => <>{items.map(renderItemContent)}</>,
}));
vi.mock('../atoms/TicketRefAtom', () => ({ useAtomRow: () => ({}), isTicketRefAtomPayload: () => false, TicketRefAtom: () => null }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));

const en = { code: 'en', name: 'English', is_default: true };
const ru = { code: 'ru', name: 'Русский' };
const documents = [{ id: 1, name: 'Language regression', slug: 'language-regression', table_id: 42, content_table_id: 42 }];
const saved = new Map<string, Partial<DocumentItem>>();
const update = vi.fn();

// Exercise the real selector, language hook, saveEditing and text editor.
// Only the data boundary and page layout are replaced; no backend is contacted.
function Fixture({ name, languages }: { name: string; languages: DocumentsWidgetConfig['languages'] }) {
  const state = useDocumentsState({ storageKey: name, config: { project_id: 1, languages }, documents, isInitialized: true });
  const editing = useInlineEditState();
  const [row, setRow] = useState<Partial<DocumentItem>>(() => saved.get(name) ?? { content_en: '', ...(languages?.length === 2 ? { content_ru: '' } : {}) });
  const item: DocumentItem = { id: 7, level: 'text', order: 10, ...row, content: String(row[`content_${state.currentLanguage}`] ?? '') };
  const context: Partial<DocumentsContextValue> = {
    ...state, ...editing, selectedDocument: documents[0], selectedDocumentId: 1, items: [item],
    isReadOnly: false, selectedItemId: null, setSelectedItemId: vi.fn(), setRightPanelMode: vi.fn(), setRightPanelOpen: vi.fn(),
    updateItem: async input => {
      update(name, input);
      const next = { ...row, ...input.data };
      saved.set(name, next);
      setRow(next);
      return { success: true };
    },
  };
  return <section aria-label={name}><DocumentsContext.Provider value={context as DocumentsContextValue}>
    <ToolbarLanguageSelector /><DocumentsContent />
  </DocumentsContext.Provider></section>;
}

beforeEach(() => {
  sessionStorage.clear();
  saved.clear();
  update.mockClear();
  localStorage.setItem('god-crm-language', 'ru');
  window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

it('saves the displayed English field by keyboard, restores focus, and reads it after remount', async () => {
  const user = userEvent.setup();
  const mounted = render(<LanguageProvider><Fixture name="english" languages={[en]} /></LanguageProvider>);
  expect(screen.getByRole('combobox', { name: 'Язык документа' })).toHaveValue('en');
  const trigger = screen.getByRole('button', { name: 'Нажмите чтобы редактировать...' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox')).toHaveFocus();
  await user.type(screen.getByRole('textbox'), 'English saved');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  expect(update).toHaveBeenCalledTimes(1);
  expect(saved.get('english')).toMatchObject({ content_en: 'English saved' });
  expect(saved.get('english')).not.toHaveProperty('content_ru');
  expect(saved.get('english')).not.toHaveProperty('content');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Редактировать текст' })).toHaveFocus());
  mounted.unmount();
  render(<LanguageProvider><Fixture name="english" languages={[en]} /></LanguageProvider>);
  expect(screen.getByRole('combobox')).toHaveValue('en');
  expect(screen.getByText('English saved')).toBeInTheDocument();
});

it('keeps a neighboring bilingual widget independent and cancels without writing', async () => {
  const user = userEvent.setup();
  render(<LanguageProvider><Fixture name="english" languages={[en]} /><Fixture name="bilingual" languages={[en, ru]} /></LanguageProvider>);
  const english = within(screen.getByRole('region', { name: 'english' }));
  const bilingual = within(screen.getByRole('region', { name: 'bilingual' }));
  expect(english.getByRole('combobox')).toHaveValue('en');
  expect(bilingual.getByRole('combobox')).toHaveValue('ru');
  for (const language of ['en', 'ru']) {
    await user.selectOptions(bilingual.getByRole('combobox'), language);
    await user.click(bilingual.getByRole('button', { name: 'Нажмите чтобы редактировать...' }));
    await user.type(bilingual.getByRole('textbox'), `Saved ${language}`);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(bilingual.queryByRole('textbox')).not.toBeInTheDocument());
    expect(saved.get('bilingual')).toHaveProperty(`content_${language}`, `Saved ${language}`);
    expect(english.getByRole('combobox')).toHaveValue('en');
  }
  const trigger = english.getByRole('button', { name: 'Нажмите чтобы редактировать...' });
  await user.click(trigger);
  await user.type(english.getByRole('textbox'), 'Unsaved draft');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(saved.has('english')).toBe(false);
  expect(update).toHaveBeenCalledTimes(2);
});
