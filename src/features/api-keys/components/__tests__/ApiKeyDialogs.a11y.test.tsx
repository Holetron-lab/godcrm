import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysManager } from '../ApiKeysManager';
import { ProjectApiKeysPage } from '@/pages/projects/ProjectApiKeysPage';
import { apiKeysApi } from '../../api/apiKeysApi';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('../../api/apiKeysApi', () => ({ apiKeysApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ data: [] }) } }));

beforeEach(() => {
  vi.mocked(apiKeysApi.list).mockResolvedValue([]);
  vi.mocked(apiKeysApi.create).mockResolvedValue({
    id: 1, key: 'fixture-key', key_prefix: 'fixture', name: 'Integration',
    scopes: ['rows:read'], rate_limit: 100, expires_at: null, created_at: '2026-09-22',
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each([
  { kind: 'manager', opener: 'Create Key', title: 'Create API Key' },
  { kind: 'project', opener: 'New Key', title: 'New API Key' },
])('$kind API key dialog', ({ kind, opener, title }) => {
  const setup = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/42/keys']}>
      <Routes><Route path="/projects/:projectId/keys" element={kind === 'manager' ? <ApiKeysManager /> : <ProjectApiKeysPage />} /></Routes>
    </MemoryRouter></QueryClientProvider>);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: opener });
    await user.click(trigger);
    return { user, trigger, dialog: screen.getByRole('dialog', { name: title }) };
  };

  it('labels fields, traps focus and returns it after Escape', async () => {
    const { user, trigger, dialog } = await setup();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(apiKeysApi.create).not.toHaveBeenCalled();
  });

  it('preserves name, scopes, expiration and project in the submitted payload', async () => {
    const { user, dialog } = await setup();
    const form = within(dialog);
    expect(form.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'Integration');
    await user.click(form.getByRole('checkbox', { name: /Read rows/ }));
    expect(form.getByRole('checkbox', { name: /Full access/ })).not.toBeChecked();
    await user.selectOptions(form.getByRole('combobox', { name: 'Expiration' }), '30');
    await user.click(form.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(apiKeysApi.create).toHaveBeenCalled());
    expect(vi.mocked(apiKeysApi.create).mock.calls[0][0]).toEqual({
      name: 'Integration', scopes: ['rows:read'], expires_in_days: 30,
      ...(kind === 'project' ? { project_id: 42, agent_id: undefined } : {}),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
