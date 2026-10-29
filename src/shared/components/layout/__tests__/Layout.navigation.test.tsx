import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { Layout } from '../Layout';

vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { id: 1, name: 'Owner' }, initialized: true }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/projects/hooks/useProjectsQuery', () => ({ useProjectsQuery: vi.fn() }));
vi.mock('@/features/spaces/hooks/useSpacesOrder', () => ({ useSpacesOrder: () => ({ getSpaceOrder: () => 0 }) }));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({ useSpacesQuery: vi.fn() }));
vi.mock('@/features/data-sources/hooks/useDataSources', () => ({ useDataSource: () => ({ data: null }) }));
vi.mock('@/features/ai-chat', () => ({ AIChatProvider: ({ children }: { children: ReactNode }) => children, AIChatPanel: () => <input aria-label="Chat draft" /> }));
vi.mock('@/shared/hooks/useTabSync', () => ({ useTabSync: vi.fn() }));
vi.mock('@/shared/hooks/useDesktopApp', () => ({ useDesktopApp: () => ({ isSettingsOpen: false }) }));
vi.mock('../Sidebar', () => ({ Sidebar: () => <nav aria-label="Main menu">Menu</nav> }));
vi.mock('../LayoutModals', () => ({ LayoutModals: () => null }));
vi.mock('../HeaderBreadcrumbs', () => ({ HeaderBreadcrumbs: () => null }));
vi.mock('../HeaderActionsMenu', () => ({ HeaderActionsMenu: () => null }));
vi.mock('../LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('../ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../FullscreenToggle', () => ({ FullscreenToggle: () => null }));
vi.mock('@/shared/components/desktop/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('@/shared/components/desktop/DesktopTabBar', () => ({ DesktopTabBar: () => null }));
vi.mock('@/shared/components/desktop/WindowControls', () => ({ WindowControls: () => null }));
vi.mock('@/shared/components/ui/Toast', () => ({ ToastContainer: () => null }));

it('keeps the header, menu and chat draft visible while a new route loads', async () => {
  let finish!: (value: { default: () => ReactNode }) => void;
  const NextPage = lazy(() => new Promise<{ default: () => ReactNode }>(resolve => { finish = resolve; }));
  const router = createMemoryRouter([{ element: <Layout />, children: [
    { path: '/spaces', element: <p>Spaces</p> }, { path: '/help', element: <NextPage /> },
  ] }], { initialEntries: ['/spaces'] });
  render(<Suspense fallback={<p>Whole app loading</p>}><RouterProvider router={router} /></Suspense>);
  const header = screen.getByRole('banner');
  const draft = screen.getByRole('textbox', { name: 'Chat draft' });
  fireEvent.change(draft, { target: { value: 'Unsent message' } });
  await act(async () => { await router.navigate('/help', { flushSync: true }); });
  expect(header).toBeVisible();
  expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  expect(draft).toBeVisible();
  expect(draft).toHaveValue('Unsent message');
  expect(screen.getByRole('status')).toHaveTextContent('common.loading');
  await act(async () => finish({ default: () => <p>Help loaded</p> }));
  expect(screen.getByText('Help loaded')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(draft);
  await act(async () => { await router.navigate(-1); });
  expect(screen.getByText('Spaces')).toBeVisible();
  expect(draft).toHaveValue('Unsent message');
});
