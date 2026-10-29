/**
 * G11 S3 browser contract: create/edit a document, then send its row chip.
 * All API traffic is intercepted; this is NOT backend persistence or staging
 * E2E evidence. Only a static SPA is needed. Real acceptance additionally needs
 * approved QA auth, a fresh godcrm_test/automation preflight and owned fixtures.
 * No credentials, existing documents, agents or backend automations are used.
 */
import { test as base, expect, type Route } from '@playwright/test';

const USER = { id: 990301, name: 'S3 QA', email: 's3@example.test', role: 'admin' };
const SPACE = { id: 990311, name: 'S3 isolated space', owner_id: USER.id, type: 'internal' };
const PROJECT = 990312;
const WIDGET = 990318;
const REGISTRY = 990397;
const DOC = 990374;
const CONTENT = 990345;
const CONVERSATION = 990360;
const widget = {
  id: WIDGET, name: 'S3 Documents', preset_name: 'documents', type: 'preset',
  project_id: PROJECT, space_id: SPACE.id,
  config: { project_id: PROJECT, registry_table_id: REGISTRY, languages: [{ code: 'ru', name: 'Русский', is_default: true }] },
};
const conversation = {
  id: CONVERSATION, title: 'S3 document chat', type: 'chat', space_id: SPACE.id,
  created_by: USER.id, participants: [], unread_count: 0,
};
type Row = { id: number; table_id: number; data: Record<string, unknown> };
type Message = { id: number; content: string; attachments: unknown[]; role: string; senderType: string; timestamp: string };
type Store = { row?: Row; messages: Message[]; writes: string[]; reads: string[]; rejectEdit: boolean };

const test = base.extend<{ store: Store }>({
  store: async ({ context, page, baseURL }, use, testInfo) => {
    const target = new URL(baseURL || 'http://localhost:5173');
    expect(['localhost', '127.0.0.1', 'dev.godcrm.ai'], 'Only local SPA or known staging static assets').toContain(target.hostname);
    expect(target.username + target.password).toBe('');
    const store: Store = { messages: [], writes: [], reads: [], rejectEdit: false };
    const unexpected: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    // Block service-worker bypass, external traffic and every real API request.
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace(/^\/api\/v3/, '');
      const method = req.method();
      const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status < 400, data }) });
      if (url.origin !== target.origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) {
        if (method === 'GET' && !url.pathname.startsWith('/socket.io')) return route.continue();
        unexpected.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      if (method === 'GET') store.reads.push(path);
      if (path === '/auth/me' || path === '/auth/refresh') return json({ user: USER, accessToken: 's3-fake-token' });
      if (method === 'GET' && req.headers().accept?.includes('text/event-stream')) {
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': isolated fixture\n\n' });
      }
      if (method === 'POST' && path === `/projects/${PROJECT}/documents`) {
        const body = req.postDataJSON();
        expect(body.registry_table_id).toBe(REGISTRY);
        expect(body.name).toMatch(/^S3-/);
        expect(store.row, 'Create must not overwrite an existing fixture').toBeUndefined();
        store.row = { id: DOC, table_id: REGISTRY, data: { ...body, table_id: CONTENT, slug: 's3-owned-document' } };
        store.writes.push('create');
        return json({ document_id: DOC, table_id: CONTENT, slug: 's3-owned-document', name: body.name });
      }
      if (method === 'PUT' && path === `/tables/${REGISTRY}/rows/${DOC}`) {
        const body = req.postDataJSON();
        expect(Object.keys(body)).toEqual(['data']);
        expect(Object.keys(body.data).sort()).toEqual(['description', 'name']);
        expect(store.row).toBeDefined();
        if (store.rejectEdit) return json({ message: 'S3 deliberate save failure' }, 503);
        store.row!.data = { ...store.row!.data, ...body.data };
        store.writes.push('edit');
        return json({ row: store.row });
      }
      if (method === 'POST' && path === `/chat/conversations/${CONVERSATION}/messages`) {
        const body = req.postDataJSON();
        expect(body.mentions || []).toEqual([]);
        const message: Message = { id: 990399, content: body.content, attachments: body.attachments,
          role: 'user', senderType: 'human', timestamp: new Date().toISOString() };
        store.messages.push(message);
        store.writes.push('send');
        return json(message);
      }
      if (method === 'POST' && [`/chat/conversations/${CONVERSATION}/presence`, `/chat/conversations/${CONVERSATION}/read`].includes(path)) return json({});
      if (method === 'POST' && path === '/chat/messages/reactions/batch') {
        expect(req.postDataJSON()).toEqual({ messageIds: [990399] });
        return json({});
      }
      // No successful generic mutation fallback: an unexpected write fails QA.
      if (method !== 'GET') {
        unexpected.push(`${method} ${path}`);
        return json({ message: 'Unexpected fixture mutation' }, 501);
      }
      if (path === '/spaces') return json([SPACE]);
      if (path === `/spaces/${SPACE.id}`) return json({ space: SPACE, projects: [], dashboard: null });
      if (path === `/projects/${PROJECT}`) return json({ id: PROJECT, space_id: SPACE.id, name: 'S3 project' });
      if (path === `/access/project/${PROJECT}/my-level`) return json({ access_level: 'owner_owner' });
      if (path === `/widgets/${WIDGET}`) return json(widget);
      if (path === `/tables/${REGISTRY}`) return json({ id: REGISTRY, name: 'Documents' });
      if (path === `/tables/${REGISTRY}/columns`) return json(['name', 'description'].map((name, index) => ({ id: 990380 + index, name, type: 'text', config: {} })));
      if (path === `/tables/${REGISTRY}/rows`) return json({ rows: store.row ? [store.row] : [] });
      if (path === `/tables/${REGISTRY}/rows/${DOC}`) return json({ row: store.row });
      if (path === `/documents/${DOC}/content`) {
        expect(url.searchParams.get('registry_table_id')).toBe(String(REGISTRY));
        return json({ document: { id: DOC, ...store.row?.data }, table_id: CONTENT, items: [], tree: [], count: 0 });
      }
      if (path === `/tables/${CONTENT}/rows`) return json({ rows: [] });
      if (path === `/chat/tasks/${REGISTRY}/${DOC}`) {
        expect(url.searchParams.get('create')).toBe('true');
        return json({ conversationId: CONVERSATION });
      }
      if (path === '/chat/conversations') return json({ conversations: [conversation], total_count: 1, has_more: false });
      if (path === `/chat/conversations/${CONVERSATION}` || path === `/chat/conversations/${CONVERSATION}/summary`) return json(conversation);
      if (path === `/chat/conversations/${CONVERSATION}/messages`) {
        const incremental = url.searchParams.has('after');
        return json({ messages: incremental ? [] : store.messages, hasMore: false });
      }
      if (path === '/ai/agents') return json({ agents: [] });
      return json([]); // Ancillary read-only lists; scenario reads above are explicit.
    });
    await context.addInitScript(user => {
      localStorage.setItem('god-crm-language', 'ru');
      localStorage.setItem('god-crm-auth', JSON.stringify({ state: { user, token: 's3-fake-token' }, version: 0 }));
    }, USER);
    try {
      await use(store);
    } finally {
      const evidence = { mode: 'mocked-browser-contract', target: target.origin, backendWrites: 0,
        automations: 'No backend requests; no automation engine in fixture',
        writes: [...store.writes], reads: [...store.reads], unexpected, pageErrors, consoleErrors };
      delete store.row;
      store.messages.length = 0;
      await testInfo.attach('S3-network-and-cleanup', { contentType: 'application/json',
        body: JSON.stringify({ ...evidence, cleanup: { documents: store.row ? 1 : 0, messages: store.messages.length } }, null, 2) });
      expect(unexpected, 'Unexpected mutations must fail, never pass silently').toEqual([]);
      expect(pageErrors).toEqual([]);
    }
  },
});

test.use({ serviceWorkers: 'block' });

for (const rejectFirstSave of [false, true]) {
test(`S3 mocked browser contract: create → ${rejectFirstSave ? 'failed save → retry' : 'edit'} → reload → exact chip`, async ({ page, store }) => {
  const name = 'S3-created document';
  const edited = 'S3-edited document';
  await page.goto(`/widgets/${WIDGET}`);
  await page.getByLabel('Новый документ', { exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Новый документ', exact: true });
  await modal.getByLabel('Название *', { exact: true }).fill(name);
  await modal.getByLabel('Описание', { exact: true }).fill('S3 original description');
  const created = page.waitForResponse(r => r.url().endsWith(`/projects/${PROJECT}/documents`) && r.request().method() === 'POST');
  await modal.getByRole('button', { name: 'Создать', exact: true }).click();
  expect((await created).status()).toBe(200);
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(store.row).toMatchObject({ id: DOC, table_id: REGISTRY, data: { name, description: 'S3 original description', table_id: CONTENT } });

  // A fresh render must read the saved fixture, rather than optimistic form state.
  await page.reload();
  await page.getByRole('heading', { name, exact: true }).getByRole('button').click();
  await page.getByPlaceholder('Название документа', { exact: true }).fill(edited);
  await page.getByPlaceholder('Описание документа (необязательно)', { exact: true }).fill('S3 saved description');
  if (rejectFirstSave) {
    store.rejectEdit = true;
    const rejected = page.waitForResponse(r => r.url().endsWith(`/tables/${REGISTRY}/rows/${DOC}`) && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await rejected).status()).toBe(503);
    await expect(page.getByPlaceholder('Название документа', { exact: true })).toHaveValue(edited);
    expect(store.row?.data.name).toBe(name);
    expect(store.writes).toEqual(['create']);
    store.rejectEdit = false;
  }
  const saved = page.waitForResponse(r => r.url().endsWith(`/tables/${REGISTRY}/rows/${DOC}`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: edited, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  expect(store.row?.data).toMatchObject({ name: edited, description: 'S3 saved description' });

  const header = page.locator('div.group').filter({ has: page.getByRole('heading', { name: edited, exact: true }) }).last();
  await header.hover();
  const binding = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v3/chat/tasks/${REGISTRY}/${DOC}`);
  await header.getByRole('button', { name: 'Open chat', exact: true }).click();
  expect((await binding).status()).toBe(200);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await header.hover();
  await header.getByRole('button', { name: 'Attach to message', exact: true }).click();
  const input = page.locator('textarea').filter({ visible: true });
  await expect(input).toHaveCount(1);
  await input.fill('S3 document reference');
  const sent = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v3/chat/conversations/${CONVERSATION}/messages` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  expect((await sent).status()).toBe(200);
  expect(store.messages).toHaveLength(1);
  expect(store.messages[0]).toMatchObject({ content: 'S3 document reference', attachments: [{ type: 'row_reference', rowReference: {
    table_id: REGISTRY, row_id: DOC, row_title: edited,
  } }] });

  // Reload chat from its API fixture; assert the chip, not just message text.
  await page.goto(`/embed/chat?space=${SPACE.id}`);
  await page.getByText(conversation.title, { exact: true }).click();
  const chip = page.getByTitle(`Documents #${DOC}`, { exact: true });
  await expect(chip.getByRole('button', { name: edited, exact: true })).toBeVisible();
  expect(store.writes).toEqual(['create', 'edit', 'send']);
  await page.screenshot({ path: test.info().outputPath('S3-chip.png'), fullPage: true });
  const resolved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v3/tables/${REGISTRY}/rows/${DOC}` && r.request().method() === 'GET');
  await chip.getByRole('button', { name: edited, exact: true }).click();
  expect((await (await resolved).json()).data.row).toMatchObject({ id: DOC, table_id: REGISTRY, data: { name: edited, description: 'S3 saved description' } });
  await expect(page.getByRole('dialog')).toContainText(edited);
});
}
