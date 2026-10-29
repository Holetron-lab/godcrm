import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PublicFormPage } from '../PublicFormPage';
import { publicApi, PublicApiError, type PublicForm } from '../publicApi';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

vi.mock('../publicApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publicApi')>();
  return { ...actual, publicApi: { getForm: vi.fn(), submitForm: vi.fn() } };
});
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (s: { initialized: boolean }) => unknown) => selector({ initialized: true }),
}));
// FieldRenderer pulls react-query relation loaders; a plain input is enough here.
vi.mock('@/features/tables/components/modals/FieldRenderer', () => ({
  FieldRenderer: ({ column, value, onChange }: { column: { name: string }; value: unknown; onChange: (v: unknown) => void }) => (
    <input aria-label={column.name} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const mockedApi = vi.mocked(publicApi);

const form: PublicForm = {
  table: { id: 5, name: 'Возвраты', icon: null },
  columns: [
    { id: 10, table_id: 5, column_name: 'order_no', display_name: '№ заказа', type: 'text', config: {}, order_index: 0, is_required: false, is_readonly: false },
    { id: 12, table_id: 5, column_name: 'source', display_name: 'Источник', type: 'text', config: {}, order_index: 1, is_required: false, is_readonly: false },
  ],
  config: {
    version: 1, layout: 'grid',
    fields: [
      { id: 'f10', columnId: '10', width: 'full', order: 0, required: true },
      { id: 'f12', columnId: '12', width: 'full', order: 1, hidden: true, urlParam: true },
    ],
    settings: { access: 'external' },
  },
  viewer: { authenticated: false },
};

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes><Route path="/forms/:tableId" element={children} /></Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>
  );
  return render(wrap(<PublicFormPage />));
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PublicFormPage', () => {
  it('prefills only urlParam fields from the query string and submits by column id', async () => {
    mockedApi.getForm.mockResolvedValue({ success: true, data: form } as never);
    mockedApi.submitForm.mockResolvedValue({ success: true, data: { id: 1, base_id: 'b' } } as never);
    const user = userEvent.setup();
    renderAt('/forms/5?source=telegram&order_no=injected');

    // hidden-but-urlParam field is shown with the URL value
    const source = await screen.findByLabelText('source');
    expect(source).toHaveValue('telegram');
    // visible field without the flag ignores the URL
    const orderNo = screen.getByLabelText('order_no');
    expect(orderNo).toHaveValue('');

    // required → blocked until filled
    await user.click(screen.getByRole('button', { name: /Отправить|Submit/ }));
    expect(mockedApi.submitForm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(orderNo, 'A-1');
    await user.click(screen.getByRole('button', { name: /Отправить|Submit/ }));
    await waitFor(() => expect(mockedApi.submitForm).toHaveBeenCalledWith(5, { 10: 'A-1', 12: 'telegram' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('offers sign-in when the form needs a signed-in user, returning here after login', async () => {
    mockedApi.getForm.mockRejectedValue(new PublicApiError(401, 'Sign in to open this form'));
    renderAt('/forms/5?source=x');
    const link = await screen.findByRole('link', { name: /Войти|Sign in/ });
    expect(link).toHaveAttribute('href', '/auth/login');
    // react-router keeps `state` off the DOM; the login page reads it via resolvePostLoginTarget
    expect(screen.getByText(/Форма доступна только|available only/)).toBeInTheDocument();
  });
});
