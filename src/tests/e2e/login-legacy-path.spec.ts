/**
 * E2E: login started from the legacy `/login` path lands in the app, not on 404
 * (Fleet Audit WP-5 — Bugs 1552/229244, beta-gate S1 in ADR-203).
 *
 * Hermetic: every /api/v3 call is answered from fixtures here, so the scenario
 * needs only the SPA (vite dev or a built bundle) — no backend, no credentials.
 *
 * Bug shape being guarded: `/login` is not a route; it fell into Layout's `*`,
 * the auth guard bounced to /auth/login with `from: '/login'`, and a successful
 * login navigated back to `/login` → NotFoundPage "Route empty. You are recorded."
 *
 * Run:  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test login-legacy --project=chromium
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const USER = { id: 990101, name: 'manual-qa-frontend-qa', email: 'manual-qa-frontend-qa@example.test', role: 'viewer' };
const SPACE = { id: 990111, name: 'manual-qa WP-5 legacy login', type: 'business', owner_id: USER.id, icon: '🧪' };
const PASSWORD = 'manual-qa-not-a-real-password';

const json = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }),
});

async function mockApi(page: Page) {
  // Playwright matches routes newest-first: generic fallback goes in first.
  await page.route(/^https?:\/\/[^/]+\/api\/v3\//, (route: Route) => {
    const method = route.request().method();
    return route.fulfill(json(method === 'GET' ? [] : {}));
  });
  // Anonymous session: no token in storage, refresh cookie missing.
  await page.route('**/api/v3/auth/refresh', r => r.fulfill(json({ code: 'UNAUTHORIZED', message: 'No refresh token' }, 401)));
  await page.route('**/api/v3/auth/me', r => r.fulfill(json({ user: USER, accessToken: 'e2e-token' })));
  await page.route('**/api/v3/auth/login', (route: Route) => {
    const body = route.request().postDataJSON() as { email?: string; password?: string };
    if (body?.email === USER.email && body?.password === PASSWORD) {
      return route.fulfill(json({ user: USER, accessToken: 'e2e-token' }));
    }
    return route.fulfill(json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, 401));
  });
  await page.route(/\/api\/v3\/spaces(\?.*)?$/, r => r.fulfill(json([{ ...SPACE, user_access_level: 'owner_owner' }])));
  await page.route(`**/api/v3/spaces/${SPACE.id}`, r => r.fulfill(json({ space: SPACE, projects: [], dashboard: null })));
}

async function login(page: Page) {
  await page.locator('input[type="email"]').fill(USER.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
}

test.describe('WP-5 (Bugs 1552/229244): legacy /login path', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test('S1: /login shows the form and a successful login lands on /spaces, not 404', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.locator('input[type="email"]')).toBeVisible();

    await login(page);

    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15000 });
    await expect(page.getByText(/Route empty|Маршрут пуст/)).toHaveCount(0);
    // The workspace actually rendered (sidebar lists the mocked space).
    await expect(page.getByTestId('spaces-menu')).toContainText(SPACE.name, { timeout: 15000 });
  });

  test('/login keeps its query string on the way to /auth/login', async ({ page }) => {
    const target = `/spaces/${SPACE.id}/dashboard`;
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
    await expect(page).toHaveURL(new RegExp(`/auth/login\\?redirect=${encodeURIComponent(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

    await login(page);
    await expect(page).toHaveURL(new RegExp(`${target}$`), { timeout: 15000 });
  });

  test('/register aliases /auth/register', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/auth\/register$/);
  });

  test('a guard bounce whose origin is an auth page still ends on /spaces', async ({ page }) => {
    // Simulate the pre-fix state: LoginPage opened with `from: '/login'`.
    await page.goto('/auth/login');
    await page.evaluate(() => window.history.replaceState({ usr: { from: '/login' }, key: 'e2e', idx: 0 }, '', '/auth/login'));
    await login(page);
    await expect(page).toHaveURL(/\/spaces$/, { timeout: 15000 });
    await expect(page.getByText(/Route empty|Маршрут пуст/)).toHaveCount(0);
  });
});
