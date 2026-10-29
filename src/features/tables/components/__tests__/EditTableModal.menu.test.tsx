import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { EditTableModal } from '../EditTableModal';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: api }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: () => ({ user: { id: 1 } }) }));
vi.mock('@/shared/components/ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/shared/components/access/UserAccessPanel', () => ({ UserAccessPanel: () => null }));
vi.mock('../ColumnsEditingTab', () => ({ ColumnsEditingTab: () => null }));
vi.mock('../DataMaintenanceTab', () => ({ DataMaintenanceTab: () => null }));
vi.mock('../UniversalTable/EmojiPicker', () => ({ EmojiPicker: () => null }));
vi.mock('../TableMenuWidgetToggle', () => ({ TableMenuWidgetToggle: ({ checked }: { checked: boolean }) => <input aria-label="menu-widget" type="checkbox" checked={checked} readOnly /> }));

const renderModal = (exists = false) => {
  api.request.mockImplementation(async (url: string) => ({ data: url.endsWith('/widgets')
    ? (exists ? [{ id: 5, preset_name: 'table_view', config: { table_id: 21 } }] : [])
    : [{ id: 21, name: 'tickets', show_in_nav: 1, project_id: 1 }] }));
  render(<LanguageProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EditTableModal open onOpenChange={() => {}} tableId={21} projectId={1} />
  </QueryClientProvider></LanguageProvider>);
};

afterEach(() => localStorage.removeItem('god-crm-language'));

describe('table menu setting reflects a real widget', () => {
  it.each([false, true])('widget exists: %s', async (exists) => {
    renderModal(exists);
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/projects/1/widgets'));
    await waitFor(() => expect(screen.getByLabelText('menu-widget')).toHaveProperty('checked', exists));
  });
});

describe('edit table modal language', () => {
  it.each([
    ['en', 'Display', 'Table name', 'Save'],
    ['ru', 'Отображение', 'Название таблицы', 'Сохранить'],
  ])('renders the %s locale', async (language, tab, nameLabel, save) => {
    localStorage.setItem('god-crm-language', language);
    renderModal();
    expect(await screen.findByRole('button', { name: tab })).toBeInTheDocument();
    expect(screen.getByText(nameLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
  });
});
