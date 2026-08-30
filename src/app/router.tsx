import { Suspense, lazy } from 'react';
import { createBrowserRouter, createHashRouter, RouterProvider, useParams, Navigate } from 'react-router-dom';
import { Layout } from '@/shared/components/layout/Layout';
import NotFoundPage from '@/pages/NotFoundPage';
import ErrorBoundaryPage from '@/pages/ErrorBoundaryPage';
import { isDesktopApp } from '@/shared/types/electron.types';
import { getMarketingBounceUrl, bounceToApp, isMarketingHost, isHoletronHost } from '@/shared/utils/marketingBounce';

// Public pages (ADR-105: AC3, AC4, AC12)
const PublicLayout = lazy(() => import('@/features/public/PublicLayout').then(m => ({ default: m.PublicLayout })));
const PublicSpacePage = lazy(() => import('@/features/public/PublicSpacePage').then(m => ({ default: m.PublicSpacePage })));
const PublicDocumentPage = lazy(() => import('@/features/public/PublicDocumentPage').then(m => ({ default: m.PublicDocumentPage })));
const PublicTablePage = lazy(() => import('@/features/public/PublicTablePage').then(m => ({ default: m.PublicTablePage })));
const PublicProjectPage = lazy(() => import('@/features/public/PublicProjectPage').then(m => ({ default: m.PublicProjectPage })));
const PublicWidgetPage = lazy(() => import('@/features/public/PublicWidgetPage').then(m => ({ default: m.PublicWidgetPage })));
// Invitation acceptance (ADR-105: AC8)
const InvitationAcceptPage = lazy(() => import('@/features/public/InvitationAcceptPage').then(m => ({ default: m.InvitationAcceptPage })));
// ADR-0044: Public marketing surface (godcrm.ai/welcome)
const LandingPage = lazy(() => import('@/pages/landing/LandingPage'));
// Holetron umbrella hero (hltrn.cc) — Marketer TZ v2 2026-05-30
const HoletronLanding = lazy(() => import('@/pages/landing/HoletronLanding'));
// Building in Public — public blog index + single post (posts open in /blog/:slug)
const BlogIndexPage = lazy(() => import('@/pages/blog/BlogIndexPage').then(m => ({ default: m.BlogIndexPage })));
const BlogPostPage = lazy(() => import('@/pages/blog/BlogPostPage').then(m => ({ default: m.BlogPostPage })));

const SpacesPage = lazy(() => import('@/pages/spaces/SpacesPage'));
const SpaceDashboardPage = lazy(() => import('@/pages/spaces/SpaceDashboardPage').then(m => ({ default: m.SpaceDashboardPage })));
const SpaceConnectorsPage = lazy(() => import('@/pages/spaces/SpaceConnectorsPage').then(m => ({ default: m.SpaceConnectorsPage })));
const TableListPage = lazy(() => import('@/pages/tables/TableListPage'));
const TableViewPage = lazy(() => import('@/pages/tables/TableViewPage'));
const RawTableViewPage = lazy(() => import('@/pages/tables/RawTableViewPage'));
const ProjectDashboardPage = lazy(() => import('@/pages/dashboards/DashboardPage').then(m => ({ default: m.DashboardPage })));
const PersonalDashboardRedirect = lazy(() => import('@/pages/dashboards/PersonalDashboardRedirect').then(m => ({ default: m.PersonalDashboardRedirect })));
const WidgetManagePage = lazy(() => import('@/pages/widgets/WidgetManagePage').then(m => ({ default: m.WidgetManagePage })));
const WidgetCreatePage = lazy(() => import('@/pages/widgets/WidgetCreatePage').then(m => ({ default: m.WidgetCreatePage })));
const WidgetViewPage = lazy(() => import('@/pages/widgets/WidgetViewPage').then(m => ({ default: m.WidgetViewPage })));
const UsersPage = lazy(() => import('@/pages/users/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const GoogleCallbackPage = lazy(() => import('@/pages/auth/GoogleCallbackPage'));
const AutomationsPage = lazy(() => import('@/features/automations').then(m => ({ default: m.AutomationsPage })));
const WebhooksPage = lazy(() => import('@/features/webhooks').then(m => ({ default: m.WebhooksPage })));
const ProjectFilesPage = lazy(() => import('@/pages/projects/ProjectFilesPage').then(m => ({ default: m.ProjectFilesPage })));
const ProjectApiKeysPage = lazy(() => import('@/pages/projects/ProjectApiKeysPage').then(m => ({ default: m.ProjectApiKeysPage })));
const HelpPage = lazy(() => import('@/pages/help'));
const SchemaEditorPage = lazy(() => import('@/features/schema-editor').then(m => ({ default: m.SchemaEditorPage })));
const AutopilotDashboardPage = lazy(() => import('@/pages/autopilot/AutopilotDashboardPage').then(m => ({ default: m.AutopilotDashboardPage })));
// ADR-158: In-CRM Mail — P1 inbox shell (mock data until mail_messages lands)
const MailPage = lazy(() => import('@/features/mail').then(m => ({ default: m.MailPage })));
// ADR-176: Universal embeddable AI chat overlay — top-level, outside <Layout>
const EmbedChatRoute = lazy(() => import('@/features/embed/EmbedChatRoute').then(m => ({ default: m.EmbedChatRoute })));

// Apex (`/`) router. On the marketing host (godcrm.ai / www.godcrm.ai) the bare
// apex is the PUBLIC landing page — no auth, no "/auth/login" bounce (owner request
// 2026-06-19: "надо на лендинг"). On the app hosts (crm.hltrn.cc, app.godcrm.ai…)
// the apex sends users into the workspace. Kept OUTSIDE the guarded <Layout> below
// so the landing renders without tripping Layout's `if (!user) → /auth/login` guard.
const RootIndex = () => {
  if (typeof window !== 'undefined') {
    // hltrn.cc / www.hltrn.cc apex = Holetron umbrella hero (the company landing).
    // Checked before the app redirect so the bare apex paints the landing, not /spaces.
    if (isHoletronHost(window.location.hostname)) {
      return <HoletronLanding />;
    }
    if (isMarketingHost(window.location.hostname)) {
      return <LandingPage />;
    }
  }
  return <Navigate to="/spaces" replace />;
};

// Route configuration shared between browser and hash router
const routes = [
  {
    path: '/',
    errorElement: <ErrorBoundaryPage />,
    children: [
      // Public, host-aware apex — not under the auth-guarded Layout.
      { index: true, element: <RootIndex /> },
      // Authenticated app surface — pathless Layout applies the chrome + auth guard.
      {
        element: <Layout />,
        children: [
          { path: 'spaces', element: <SpacesPage /> },
          { path: 'dashboard', element: <PersonalDashboardRedirect /> },
          { path: 'spaces/:id/dashboard', element: <SpaceDashboardPage /> },
          { path: 'spaces/:spaceId/schema', element: <SchemaEditorPage /> },
          { path: 'spaces/:spaceId/settings/connectors', element: <SpaceConnectorsPage /> },
          { path: 'projects/:projectId/dashboard', element: <ProjectDashboardPage /> },
          { path: 'projects/:projectId/automations', element: <AutomationsPage /> },
          { path: 'projects/:projectId/webhooks', element: <WebhooksPage /> },
          { path: 'projects/:projectId/api-keys', element: <ProjectApiKeysPage /> },
          { path: 'projects/:projectId/files', element: <ProjectFilesPage /> },
          { path: 'projects/:projectId/autopilot', element: <AutopilotDashboardPage /> },
          { path: 'projects/:projectId/widgets/create', element: <WidgetCreatePage /> },
          { path: 'widgets/:widgetId', element: <WidgetViewPage /> },
          { path: 'widgets/:widgetId/edit', element: <WidgetManagePage /> },
          { path: 'projects/:projectId/tables', element: <TableListPage /> },
          { path: 'tables/:tableId', element: <TableViewPage /> },
          { path: 'tables/:tableId/automations', element: <AutomationsPage /> },
          { path: 'data-sources/:dataSourceId/tables/:tableId', element: <RawTableViewPage /> },
          { path: 'mail', element: <MailPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'help', element: <HelpPage /> },
          { path: '*', element: <NotFoundPage /> }
        ]
      }
    ]
  },
  {
    path: '/auth',
    errorElement: <ErrorBoundaryPage />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'google/complete', element: <GoogleCallbackPage /> },
      { path: 'google/callback', element: <GoogleCallbackPage /> }
    ]
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
    errorElement: <ErrorBoundaryPage />
  },
  // Invitation acceptance - semi-public (ADR-105 AC8)
  {
    path: '/invitations/:token',
    element: <InvitationAcceptPage />,
    errorElement: <ErrorBoundaryPage />
  },
  // ADR-176: Embeddable AI chat overlay — self-guarding (own auth check), no <Layout> chrome
  {
    path: '/embed/chat',
    element: <EmbedChatRoute />,
    errorElement: <ErrorBoundaryPage />
  },
  // ADR-0044: Public marketing surface — no auth required
  {
    path: '/welcome',
    element: <LandingPage />,
    errorElement: <ErrorBoundaryPage />
  },
  // Holetron umbrella hero — hltrn.cc destination
  {
    path: '/hltrn',
    element: <HoletronLanding />,
    errorElement: <ErrorBoundaryPage />
  },
  // Building in Public — public blog index (no auth required)
  {
    path: '/blog',
    element: <BlogIndexPage />,
    errorElement: <ErrorBoundaryPage />
  },
  // Building in Public — single post (no auth required)
  {
    path: '/blog/:slug',
    element: <BlogPostPage />,
    errorElement: <ErrorBoundaryPage />
  },
  // Public space pages - no auth required (ADR-105)
  {
    path: '/s/:slug',
    element: <PublicLayout />,
    errorElement: <ErrorBoundaryPage />,
    children: [
      { index: true, element: <PublicSpacePage /> },
      { path: 'docs', element: <PublicSpacePage /> },
      { path: 'docs/:docSlug', element: <PublicDocumentPage /> },
      { path: 'tables/:tableId', element: <PublicTablePage /> },
      { path: 'projects/:projectId', element: <PublicProjectPage /> },
      { path: 'widgets/:widgetId', element: <PublicWidgetPage /> },
    ]
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
];

// Use HashRouter for desktop app (file:// protocol doesn't support BrowserRouter)
// Use BrowserRouter for web app
const router = isDesktopApp() ? createHashRouter(routes) : createBrowserRouter(routes);

// SPA-navigation guard — mirrors the initial-load bounce in main.tsx so that
// in-app <Link>/navigate() into /auth/* on godcrm.ai also hops to app.godcrm.ai.
if (typeof window !== 'undefined' && !isDesktopApp()) {
  let lastPath = window.location.pathname;
  router.subscribe((state) => {
    const path = state.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const target = getMarketingBounceUrl(
      window.location.hostname,
      path,
      state.location.search,
      state.location.hash
    );
    if (target) bounceToApp(target);
  });
}

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
    <p className="text-base text-[var(--text-secondary)]">Loading GOD CRM workspace...</p>
  </div>
);

export const AppRouter = () => {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <RouterProvider router={router} />
    </Suspense>
  );
};
