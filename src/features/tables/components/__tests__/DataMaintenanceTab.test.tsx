import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DataMaintenanceTab } from '../DataMaintenanceTab';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: api }));

afterEach(() => localStorage.removeItem('god-crm-language'));

describe('data maintenance tab language', () => {
  it.each([
    ['en', 'Data maintenance', 'Normalize data', 'All data is in the normalized format (column_name).'],
    ['ru', 'Обслуживание данных', 'Нормализовать данные', 'Все данные в нормализованном формате (column_name).'],
  ])('renders the %s locale', async (language, title, normalize, status) => {
    localStorage.setItem('god-crm-language', language);
    api.request.mockImplementation(async (url: string) => (url.endsWith('/columns') ? { data: [] } : { data: { rows: [] } }));
    render(
      <LanguageProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <DataMaintenanceTab tableId={21} />
        </QueryClientProvider>
      </LanguageProvider>
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(await screen.findByText(status)).toBeTruthy();
    expect(screen.getByRole('button', { name: normalize })).toBeTruthy();
  });
});
