/**
 * E2E: a user with the GLOBAL role `viewer` who OWNS a space sees the owner
 * tools inside that space (Fleet Audit WP-5 — Bugs 1552/228713, ADR-203 G5,
 * D3 default: the global role gates system settings only).
 *
 * Hermetic: every /api/v3 call is answered from fixtures in this file.
 *
 * Two owned spaces are served on purpose:
 *  - OWN_BACKEND carries `user_access_level: 'owner_owner'` exactly as
 *    backend/services/space/crud.js sends it — pins SpaceCard, which used to
 *    accept only 'owner' | 'admin' and hid the "+ project" button from owners.
 *  - OWN_FALLBACK has no `user_access_level` at all — pins the FE fallback in
 *    useSpaceAccessLevel, which must resolve ownership before the global role.
 * FOREIGN is owned by someone else: the same user must stay a viewer there.
 *
 * Run:  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test global-viewer --project=chromium
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const USER = { id: 990201, name: 'manual-qa-frontend-qa', email: 'manual-qa-frontend-qa@example.test', role: 'viewer' };
const OWN_BACKEND = { id: 990211, name: 'manual-qa WP-5 own (backend level)', type: 'business', owner_id: USER.id, icon: '🧪', user_access_level: 'owner_owner' };
const OWN_FALLBACK = { id: 990212, name: 'manual-qa WP-5 own (fe fallback)', type: 'business', owner_id: USER.id, icon: '🧪' };
const FOREIGN = { id: 990213, name: 'manual-qa WP-5 foreign', type: 'business', owner_id: 1, icon: '🧪', visibility: 'open' };
const SPACES = [OWN_BACKEND, OWN_FALLBACK, FOREIGN];

const json = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, data }),
});

async function mockApi(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\/v3\//, (route: Route) => {
    const method = route.request().method();
    return route.fulfill(json(method === 'GET' ? [] : {}));
  });
  await page.route('**/api/v3/auth/me', r => r.fulfill(json({ user: USER, accessToken: 'e2e-token' })));
  await page.route('**/api/v3/auth/refresh', r => r.fulfill(json({ user: USER, accessToken: 'e2e-token' })));
  await page.route(/\/api\/v3\/spaces(\?.*)?$/, r => r.fulfill(json(SPACES)));
  for (const s of SPACES) {
    await page.route(`**/api/v3/spaces/${s.id}`, r => r.fulfill(json({ space: s, projects: [], dashboard: null })));
  }
}

/** Sidebar card of a space (data-testid="space-item") by its name. */
const sidebarSpace = (page: Page, name: string) =>
  page.getByTestId('space-item').filter({ hasText: name }).first();

const SPACE_MENU = /Space menu|Меню пространства/;
const CREATE_PROJECT = /Create project|Создать проект/;

test.describe('WP-5 (Bugs 1552/228713): global viewer who owns a space', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(([user]) => {
      window.localStorage.setItem('god-crm-auth', JSON.stringify({ state: { token: 'e2e-token', user }, version: 0 }));
    }, [USER]);
    await page.goto('/spaces');
    await expect(page.getByTestId('spaces-menu')).toContainText(OWN_FALLBACK.name, { timeout: 15000 });
  });

  test('G5: sidebar shows the owner menu in both owned spaces and only search in the foreign one', async ({ page }) => {
    await expect(sidebarSpace(page, OWN_BACKEND.name).getByTitle(SPACE_MENU)).toBeVisible();
    await expect(sidebarSpace(page, OWN_FALLBACK.name).getByTitle(SPACE_MENU)).toBeVisible();
    await expect(sidebarSpace(page, FOREIGN.name).getByTitle(SPACE_MENU)).toHaveCount(0);
    await expect(sidebarSpace(page, FOREIGN.name).getByTitle(/Search|Поиск/)).toBeVisible();
  });

  test('G5: space cards offer "+ project" on both owned spaces and not on the foreign one', async ({ page }) => {
    const createButtons = page.getByTitle(CREATE_PROJECT);
    // Exactly the two owned cards: `owner_owner` from the backend and the FE fallback.
    await expect(createButtons).toHaveCount(2);
    await expect(createButtons.first()).toBeVisible();
    await expect(createButtons.nth(1)).toBeVisible();
  });
});
