import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';

const ctx = vi.hoisted(() => ({
  isReadOnly: false, isMobile: false, isCreating: false,
  selectedDocumentId: 7,
  selectedDocument: { id: 7, name: 'Руководство', content_table_id: 42 },
  currentLanguage: 'ru', contentScale: 100, viewScale: 100,
  availableLanguages: [{ code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }],
  setCurrentLanguage: vi.fn(),
  statusFilter: 'all', statusOptions: [], items: [], dataSource: 'public',
  setContentScale: vi.fn(), deleteDocument: vi.fn(),
  setSelectedDocumentId: vi.fn(), setSelectedItemId: vi.fn(), setRightPanelOpen: vi.fn(),
}));
vi.mock('../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../atoms/TicketRefAtom/InsertTicketAtomModal', () => ({ InsertTicketAtomModal: () => null }));
vi.mock('../sidebar/StatusDropdown', () => ({ StatusDropdown: () => null }));
vi.mock('../useDocumentChat', () => ({ useDocumentChat: () => ({ openDocumentChat: vi.fn() }) }));
vi.mock('@/features/ai-chat', () => ({ useAIChat: () => ({ attachRowToMessage: vi.fn() }) }));
import { ToolbarCreateMenu } from '../toolbar/ToolbarCreateMenu';
import { ToolbarViewActions } from '../toolbar/ToolbarViewActions';
import { ToolbarExportActions } from '../toolbar/ToolbarExportActions';
import { ToolbarMobileOverflow } from '../toolbar/ToolbarMobileOverflow';
import { ToolbarLanguageSelector } from '../toolbar/ToolbarLanguageSelector';
import { SidebarItemsTree } from '../sidebar/SidebarItemsTree';

function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return <button onClick={() => setLanguage(language === 'en' ? 'ru' : 'en')}>Switch language</button>;
}

beforeEach(() => {
  localStorage.setItem('god-crm-language', 'en');
  vi.clearAllMocks();
  ctx.isReadOnly = false;
});

it('translates the screenshot controls and menu live, independently of document language', () => {
  render(<LanguageProvider><LanguageSwitch /><ToolbarCreateMenu /><ToolbarViewActions /><ToolbarLanguageSelector />
    <SidebarItemsTree showInlineWidgets={false} setShowInlineWidgets={vi.fn()} />
  </LanguageProvider>);
  const add = screen.getByRole('button', { name: 'Add' });
  expect(screen.getByText('Text')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All documents' })).toBeInTheDocument();
  expect(screen.getByText('Document is empty.')).toBeInTheDocument();
  expect(screen.getByText('Руководство')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Document language' })).toHaveValue('ru');
  fireEvent.mouseEnter(add.parentElement!);
  expect(screen.getByRole('button', { name: /Page break/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Widget/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
  expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Все документы' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Язык документа' })).toHaveValue('ru');
  expect(screen.getByRole('button', { name: /Разрыв страницы/ })).toBeInTheDocument();
  expect(screen.getByTitle('Масштаб текста (влияет на печать)')).toHaveTextContent('Текст');
  expect(ctx.currentLanguage).toBe('ru');
});

it.each(['en', 'ru'])('localizes desktop actions and delete confirmation in %s', language => {
  localStorage.setItem('god-crm-language', language);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<LanguageProvider><ToolbarExportActions /></LanguageProvider>);
  const isEnglish = language === 'en';
  expect(screen.getByRole('button', { name: isEnglish ? 'Print' : 'Печать' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: isEnglish ? 'Delete document' : 'Удалить документ' }));
  expect(confirm).toHaveBeenCalledWith(isEnglish
    ? 'Delete document "Руководство"? This action cannot be undone.'
    : 'Удалить документ "Руководство"? Это действие нельзя отменить.');
  expect(ctx.deleteDocument).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it('translates mobile actions and preserves scale behavior', () => {
  localStorage.setItem('god-crm-language', 'ru');
  render(<LanguageProvider><ToolbarMobileOverflow /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Другие действия' }));
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Печать' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Увеличить текст' }));
  expect(ctx.setContentScale).toHaveBeenCalledWith(110);
});
