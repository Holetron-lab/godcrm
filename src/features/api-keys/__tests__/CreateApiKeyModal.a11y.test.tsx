import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateApiKeyModal } from '../components/CreateApiKeyModal';

vi.mock('../api/apiKeysApi', () => ({ apiKeysApi: { create: vi.fn() } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>New key</button>
    <CreateApiKeyModal open={open} onClose={() => setOpen(false)} />
    <button>Outside</button>
  </>;
}

describe('API key dialog keyboard access', () => {
  it('names the dialog, contains focus and restores the opener after Escape', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    const opener = screen.getByRole('button', { name: 'New key' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'New API Key' });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    for (let i = 0; i < 18; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
