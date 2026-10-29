import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { Layout } from '../Layout';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { Widget } from '@/features/widgets/types/widget.types';

const widgetRequests = new Map<number, (widget: Widget) => void>();

vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { id: 1, name: 'Owner' }, initialized: true }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/projects/hooks/useProjectsQuery', () => ({ useProjectsQuery: vi.fn() }));
vi.mock('@/features/spaces/hooks/useSpacesOrder', () => ({ useSpacesOrder: () => ({ getSpaceOrder: () => 0 }) }));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({ useSpacesQuery: vi.fn() }));
vi.mock('@/features/data-sources/hooks/useDataSources', () => ({ useDataSource: () => ({ data: null }) }));
vi.mock('@/features/ai-chat', () => ({ AIChatProvider: ({ children }: { children: ReactNode }) => children, AIChatPanel: () => null }));
vi.mock('@/shared/hooks/useTabSync', () => ({ useTabSync: vi.fn() }));
vi.mock('@/shared/hooks/useDesktopApp', () => ({ useDesktopApp: () => ({ isSettingsOpen: false }) }));
vi.mock('@/features/widgets/api/widgetsApi', () => ({
  getWidgetById: (id: number) => new Promise<Widget>(resolve => { widgetRequests.set(id, resolve); }),
}));
// The real Sidebar unmounts a project's subtree when the project leaves
// `expandedProjects`; rendering the set is enough to observe that.
vi.mock('../Sidebar', () => ({
  Sidebar: ({ expandedProjects }: { expandedProjects: Set<number> }) => (
    <nav aria-label="Main menu">{[...expandedProjects].join(',') || 'collapsed'}</nav>
  ),
}));
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

const widget = (id: number): Widget => ({ id, project_id: 5, space_id: 1, title: `Widget ${id}` } as unknown as Widget);

beforeEach(() => {
  widgetRequests.clear();
  useSpacesStore.setState({ spaces: [{ id: 1, name: 'Development', type: 'team' }] as never });
  useProjectStore.setState({ projects: [{ id: 5, name: 'BDD', space_id: 1 }] as never, currentProjectId: 5 });
});

it('keeps the project expanded in the sidebar while a widget route resolves its widget', async () => {
  const router = createMemoryRouter([{ element: <Layout />, children: [
    { path: '/projects/:projectId/dashboard', element: <p>Dashboard</p> },
    { path: '/widgets/:widgetId', element: <p>Widget</p> },
  ] }], { initialEntries: ['/projects/5/dashboard'] });
  render(<RouterProvider router={router} />);
  const menu = screen.getByRole('navigation', { name: 'Main menu' });
  expect(menu).toHaveTextContent('5');

  // Project → widget: the widget is still loading, the tree must not collapse.
  await act(async () => { await router.navigate('/widgets/9'); });
  expect(menu).toHaveTextContent('5');
  await act(async () => { widgetRequests.get(9)!(widget(9)); });
  expect(menu).toHaveTextContent('5');

  // Widget → widget inside the same project: same rule.
  await act(async () => { await router.navigate('/widgets/10'); });
  expect(menu).toHaveTextContent('5');
  await act(async () => { widgetRequests.get(10)!(widget(10)); });
  expect(menu).toHaveTextContent('5');
});
