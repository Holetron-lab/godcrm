import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupSettings } from '../components/BackupSettings';
import { DBMonitoring } from '../components/DBMonitoring';
import { GoogleAuthSettings } from '../components/GoogleAuthSettings';
import { SMTPConfigurator } from '../components/SMTPConfigurator';

const mocks = vi.hoisted(() => ({
  role: 'user',
  read: vi.fn().mockResolvedValue({ success: true, data: { backups: [] } }),
  write: vi.fn(),
}));
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (state: { user: { role: string } }) => unknown) => selector({ user: { role: mocks.role } }),
}));
vi.mock('../api/systemApi', () => ({ systemApi: {
  fetchBackups: mocks.read, fetchDbStats: mocks.read, fetchSettings: mocks.read,
  createBackup: mocks.write, runVacuum: mocks.write,
} }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: mocks.read } }));

beforeEach(() => { mocks.role = 'user'; vi.clearAllMocks(); });
afterEach(cleanup);

describe.each([BackupSettings, DBMonitoring, GoogleAuthSettings, SMTPConfigurator])('%s access boundary', (Panel) => {
  it('mounts privileged hooks only after authorization and unmounts on revocation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <QueryClientProvider client={client}><Panel /></QueryClientProvider>;
    const { container, rerender } = render(ui());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.role = 'owner';
    rerender(ui());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(container).not.toBeEmptyDOMElement();
    mocks.role = 'user';
    rerender(ui());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.write).not.toHaveBeenCalled();
    client.clear();
  });
});
