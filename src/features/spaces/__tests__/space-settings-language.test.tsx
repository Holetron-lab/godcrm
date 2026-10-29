import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import { DEFAULT_ROLE_MAPPINGS } from '@/shared/components/access/user-access/constants';
import { SpaceVariablesTab } from '../components/SpaceVariablesTab';
import { apiClient } from '@/shared/utils/apiClient';
import type { UserAccessLevel } from '@/shared/types/user-access.types';

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { get: vi.fn(), request: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/shared/components/access/user-access/useUserAccessQueries', () => ({
  useUserAccessQueries: () => ({
    systemUsers: [], allUsers: [], usersTableRows: [], permissions: [],
    usersColumnMap: {}, tableColumns: [], isLoadingSettings: false,
    isLoadingTables: false, isLoadingUsersTable: false, refetchUsersTable: vi.fn(),
    tablesData: { tables: [], default_table_id: 90 },
    accessSettings: { access_control: {
      enabled: true, users_table_id: 90, role_column_id: 'role',
      role_mappings: DEFAULT_ROLE_MAPPINGS,
    } },
  }),
}));

function LanguageSwitch() {
  const { setLanguage } = useLanguage();
  return <button onClick={() => setLanguage('ru')}>Switch to Russian</button>;
}

function renderSettings(content: React.ReactNode) {
  localStorage.setItem('god-crm-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<LanguageProvider><QueryClientProvider client={client}>
    <LanguageSwitch />{content}
  </QueryClientProvider></LanguageProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('space settings language regressions', () => {
  it('translates Variables and preserves unsaved input when switching language', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { tableId: 90, variables: [] } });
    renderSettings(<SpaceVariablesTab spaceId={11} />);
    expect(await screen.findByText('Space variables')).toBeInTheDocument();
    expect(screen.getByText('Variables: 0')).toBeInTheDocument();
    expect(screen.getByText('No variables yet. Add your first one!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open table' })).toHaveAttribute('href', '/tables/90');
    expect(screen.getByPlaceholderText('Formula (e.g. SUM({{revenue}}))')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('$name'), { target: { value: '$budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Russian' }));
    expect(screen.getByText('Переменные пространства')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('$имя')).toHaveValue('$budget');
    expect(screen.getByRole('button', { name: 'Пересчитать' })).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each<[UserAccessLevel, string[]]>([
    ['owner_owner', ['owner', 'admin', 'editor', 'viewer', 'denied']],
    ['admin', ['editor', 'viewer', 'denied']],
  ])('translates role labels without changing assignable values for %s', async (level, values) => {
    renderSettings(<UserAccessPanel entityType="space" entityId={11} spaceId={11} currentUserLevel={level} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Access' }));
    const select = await screen.findByRole('combobox', { name: 'Access level' });
    expect(screen.getByRole('button', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByText('Administrator', { selector: 'span' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Viewer' })).toHaveValue('viewer');
    expect(within(select).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(values);
    fireEvent.change(screen.getByLabelText('Column value'), { target: { value: 'custom_role' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Russian' }));
    expect(screen.getByRole('button', { name: 'Доступ' })).toBeInTheDocument();
    expect(screen.getByText('Администратор', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByLabelText('Значение колонки')).toHaveValue('custom_role');
    const russianSelect = screen.getByRole('combobox', { name: 'Уровень доступа' });
    expect(within(russianSelect).getByRole('option', { name: 'Наблюдатель' })).toHaveValue('viewer');
    expect(within(russianSelect).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(values);
    expect(apiClient.request).not.toHaveBeenCalled();
  });
});
