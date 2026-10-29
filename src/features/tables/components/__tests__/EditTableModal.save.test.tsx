import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useImperativeHandle, type Ref } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { EditTableModal } from '../EditTableModal';
import type { ColumnsEditingTabHandle } from '../ColumnsEditingTab';

const api = vi.hoisted(() => ({ request: vi.fn(), getAccessToken: () => null }));
const savePendingEdits = vi.hoisted(() => vi.fn(async () => {}));
const fetchMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })));

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: api }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: () => ({ user: { id: 1 } }) }));
vi.mock('@/shared/components/ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/shared/components/access/UserAccessPanel', () => ({ UserAccessPanel: () => null }));
vi.mock('../DataMaintenanceTab', () => ({ DataMaintenanceTab: () => null }));
vi.mock('../UniversalTable/EmojiPicker', () => ({ EmojiPicker: () => null }));
vi.mock('../ColumnsEditingTab', () => ({
  ColumnsEditingTab: ({ ref }: { ref?: Ref<ColumnsEditingTabHandle> }) => {
    useImperativeHandle(ref, () => ({ savePendingEdits }), []);
    return <div data-testid="columns-tab" />;
  },
}));
vi.mock('../TableMenuWidgetToggle', () => ({
  TableMenuWidgetToggle: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <input aria-label="menu-widget" type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}));

vi.stubGlobal('fetch', fetchMock);

const renderModal = () => {
  api.request.mockImplementation(async (url: string) => ({
    data: url.endsWith('/widgets') ? [] : [{ id: 21, name: 'tickets', show_in_nav: 1, project_id: 1 }],
  }));
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditTableModal open onOpenChange={() => {}} tableId={21} projectId={1} />
      </QueryClientProvider>
    </LanguageProvider>
  );
};

const patchBody = () => {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
};

beforeEach(() => {
  fetchMock.mockClear();
  savePendingEdits.mockClear();
  localStorage.setItem('god-crm-language', 'en');
});

describe('edit table modal save', () => {
  it('leaves show_in_nav alone when the menu toggle was not touched', async () => {
    renderModal();
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/projects/1/widgets'));
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchBody()).not.toHaveProperty('show_in_nav');
  });

  it('sends show_in_nav once the menu toggle is switched', async () => {
    renderModal();
    const save = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/projects/1/widgets'));
    fireEvent.click(screen.getByLabelText('menu-widget'));
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchBody().show_in_nav).toBe(true);
  });

  it('flushes staged column edits before patching the table', async () => {
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Editing' }));
    expect(screen.getByTestId('columns-tab')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savePendingEdits).toHaveBeenCalledTimes(1);
    expect(savePendingEdits.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });
});
