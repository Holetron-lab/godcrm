/**
 * E2E: two agents in one conversation keep separate bubbles
 * (Fleet Audit WP-2 FE half — Bugs 1552/228710, beta-gate G6 in ADR-203).
 *
 * Hermetic: every /api/** call is answered from fixtures in this file, so the
 * scenario needs only the SPA (vite dev or a built bundle) — no backend, no
 * credentials, no agents actually running. What it pins down is the rendering
 * contract between GET /chat/conversations/:id/messages (lazy step groups with
 * agent_id/agent_name, produced by backend/routes/v3/chat/stepGroups.js) and
 * groupMessagesIntoTurns + ChatTurn.
 *
 * Bug shape being guarded: Orchestrator posts a visible message, then Architect
 * works (thinking + tools) before the next human message. The hidden steps are
 * annotated on Orchestrator's message as `_step_groups_after`. Before the fix
 * every group in that annotation rendered inside Orchestrator's bubble
 * ("6 шагов", no Architect bubble at all).
 *
 * Run:  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test chat-two-agents --project=chromium
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const USER = { id: 990001, name: 'manual-qa-frontend-qa', email: 'manual-qa-frontend-qa@example.test', role: 'admin' };
const SPACE = { id: 990011, name: 'manual-qa WP-2', type: 'internal', owner_id: USER.id, icon: '🧪' };
const CONV_ID = 990002;
const CONV_TITLE = 'manual-qa WP-2 two agents';

const ORCH = { agent_id: 7, agent_name: 'Orchestrator', agent_icon: '🎯', agent_color: '#f59e0b' };
const ARCH = { agent_id: 9, agent_name: 'Architect', agent_icon: '🏛️', agent_color: '#3b82f6' };

const T0 = '2026-09-10T08:00:00.000Z';
const T1 = '2026-09-10T08:00:05.000Z';
const T2 = '2026-09-10T08:01:00.000Z';

const conversation = {
  id: CONV_ID,
  title: CONV_TITLE,
  type: 'chat',
  agent_id: ORCH.agent_id,
  agent_name: ORCH.agent_name,
  agent_icon: ORCH.agent_icon,
  unread_count: 0,
  updated_at: T2,
  created_by: USER.id,
  space_id: SPACE.id,
  participants: [],
};

// Shape of GET /chat/conversations/:id/messages rows (messageController → parsed[]).
const messages = [
  {
    id: 1, role: 'user', content: 'раздавай', contentType: 'text', senderType: 'human',
    sender_id: USER.id, sender_name: USER.name, created_at: T0, timestamp: T0, metadata: {},
  },
  {
    id: 2, role: 'assistant', content: 'Раздаю четыре пакета.', contentType: 'text', senderType: 'agent',
    agent_id: ORCH.agent_id, created_at: T1, timestamp: T1,
    metadata: { agent_name: ORCH.agent_name, agent_row_id: ORCH.agent_id, agent_icon: ORCH.agent_icon, agent_color: ORCH.agent_color },
    // Orchestrator's own tools, then Architect's thinking + tools — all hidden
    // between message 2 and message 9, so the backend hangs them here.
    _step_groups_after: [
      { type: 'tools', count: 2, first_id: 3, last_id: 4, ...ORCH },
      { type: 'thinking', count: 1, first_id: 5, last_id: 5, preview: 'Смотрю ADR-203 и колонки 1552', ...ARCH },
      { type: 'tools', count: 3, first_id: 6, last_id: 8, ...ARCH },
    ],
    _total_hidden_after: 6,
  },
  {
    id: 9, role: 'user', content: 'ок', contentType: 'text', senderType: 'human',
    sender_id: USER.id, sender_name: USER.name, created_at: T2, timestamp: T2, metadata: {},
  },
];

const json = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, data }),
});

async function mockApi(page: Page) {
  // Playwright matches routes newest-first: generic fallback goes in first.
  // Anchored on the API prefix — a bare `**/api/**` also swallows vite module
  // URLs such as /src/features/auth/api/authApi.ts and blanks the page.
  await page.route(/^https?:\/\/[^/]+\/api\/v3\//, (route: Route) => {
    const method = route.request().method();
    return route.fulfill(json(method === 'GET' ? [] : {}));
  });
  await page.route('**/api/v3/auth/me', r => r.fulfill(json({ user: USER, accessToken: 'e2e-token' })));
  await page.route('**/api/v3/auth/refresh', r => r.fulfill(json({ user: USER, accessToken: 'e2e-token' })));
  await page.route(/\/api\/v3\/spaces(\?.*)?$/, r => r.fulfill(json([SPACE])));
  await page.route(`**/api/v3/spaces/${SPACE.id}`, r => r.fulfill(json(SPACE)));
  await page.route(/\/api\/v3\/ai\/agents(\/\d+)?(\?.*)?$/, r => r.fulfill(json({ agents: [] })));
  await page.route(/\/api\/v3\/chat\/conversations(\?.*)?$/, r => r.fulfill(json({
    conversations: [conversation], total_count: 1, has_more: false, limit: 30, offset: 0,
  })));
  await page.route(`**/api/v3/chat/conversations/${CONV_ID}`, r => r.fulfill(json(conversation)));
  await page.route(`**/api/v3/chat/conversations/${CONV_ID}/summary`, r => r.fulfill(json({
    id: CONV_ID, title: CONV_TITLE, type: 'chat', participants: [],
    agent: { id: ORCH.agent_id, name: ORCH.agent_name, icon: ORCH.agent_icon },
  })));
  await page.route(new RegExp(`/api/v3/chat/conversations/${CONV_ID}/messages`), (route: Route) => {
    const url = new URL(route.request().url());
    const types = url.searchParams.get('content_types') || '';
    // Incremental polls (after=) and status/plan probes must not re-feed the fixture.
    const isPage = !url.searchParams.has('after') && (types === '' || types.includes('text'));
    return route.fulfill(json({ messages: isPage ? messages : [], hasMore: false }));
  });
}

/** The ChatTurn root that carries a given sender-name header. */
function bubble(page: Page, senderName: string) {
  return page
    .locator('div.group.relative.w-full')
    .filter({ has: page.getByText(senderName, { exact: true }) })
    .first();
}

test.describe('WP-2 (Bugs 1552/228710): two agents in one conversation', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    // Zustand persist blob the auth store rehydrates from → initialize() hits /auth/me (mocked).
    await page.addInitScript(([user]) => {
      window.localStorage.setItem('god-crm-language', 'ru');
      window.localStorage.setItem('god-crm-auth', JSON.stringify({ state: { token: 'e2e-token', user }, version: 0 }));
    }, [USER]);
  });

  test('G6: Architect gets its own bubble instead of folding into Orchestrator', async ({ page }) => {
    // The embed route renders AIChatPanel already open; with no active
    // conversation the panel auto-opens the inbox (ADR-129 WP-2).
    await page.goto(`/embed/chat?space=${SPACE.id}`);
    await page.getByText(CONV_TITLE, { exact: true }).first().click({ timeout: 15000 });

    const orchestrator = bubble(page, ORCH.agent_name);
    const architect = bubble(page, ARCH.agent_name);
    await expect(orchestrator).toBeVisible({ timeout: 15000 });
    await expect(architect).toBeVisible({ timeout: 15000 });

    // Each agent counts only its own hidden steps.
    await expect(orchestrator.getByRole('button', { name: 'Шагов: 2', exact: true })).toBeVisible();
    await expect(architect.getByRole('button', { name: 'Шагов: 4 — Смотрю ADR-203 и колонки 1552', exact: true })).toBeVisible();
    await expect(orchestrator.getByRole('button', { name: /^Шагов: 6(?: —|$)/ })).toHaveCount(0);

    // Chronology: Orchestrator spoke first, Architect worked after it.
    const [o, a] = await Promise.all([orchestrator.boundingBox(), architect.boundingBox()]);
    expect(o && a && o.y < a.y).toBe(true);

    // Architect's placeholder bubble is a finished summary, not a live spinner.
    await expect(architect.locator('.animate-spin')).toHaveCount(0);
  });
});
