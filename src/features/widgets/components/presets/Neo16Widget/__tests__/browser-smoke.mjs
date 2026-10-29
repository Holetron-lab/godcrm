// Real module HTTP routes + godcrm_test; deterministic rules evaluator, never live Codex.
import '../../../../../../../backend/test/setup.js';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { dbGet, destroyAdapter } from '../../../../../../../backend/database/connection.js';
import { createEphemeralWorkspace } from '../../../../../../../backend/tests/helpers/workspace-fixture.js';
import { installModule, uninstallModule } from '../../../../../../../backend/services/ModuleInstaller.js';
import { NEO16_BLUEPRINT } from '../../../../../../../backend/modules/neo16/blueprint.js';
import neo16 from '../../../../../../../backend/modules/neo16/routes.js';
import columns from '../../../../../../../backend/routes/v3/tables/tableColumnController.js';
import rows from '../../../../../../../backend/routes/v3/tables/tableRowCreateController.js';

const root = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const entry = 'src/features/widgets/components/presets/Neo16Widget/__tests__/browser/index.html';
const artifacts = await mkdtemp('/tmp/neo16-town-browser-');
let ws, installed, http, vite, browser, page;
const errors = []; const requests = []; const worldReplies = [];
try {
  const target = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  assert.equal(target.db, 'godcrm_test');
  assert.ok([null, '127.0.0.1', '::1'].includes(target.host));
  ws = await createEphemeralWorkspace({ label: 'neo16-town-browser', table: false, dashboard: false });
  installed = await installModule({ blueprint: NEO16_BLUEPRINT, spaceId: ws.spaceId, projectId: ws.projectId, userId: ws.userId });
  const widget = await dbGet('SELECT * FROM widgets WHERE id = ?', [installed.widgets[0].widget_id]);
  // Match the widget API's JSON normalization before passing props to the preset.
  if (typeof widget.config === 'string') widget.config = JSON.parse(widget.config);
  const app = express();
  app.use(express.json());
  // Fixed ephemeral fixture actor; server binds loopback only and is never deployed.
  app.use((req, _res, next) => { req.user = { id: ws.userId }; next(); });
  app.get('/fixture/widget', (_req, res) => res.json(widget));
  app.use('/api/v3/neo16', neo16);
  app.use('/api/v3', columns, rows);
  http = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const apiOrigin = `http://127.0.0.1:${http.address().port}`;
  const tableId = installed.mapping.content.table_id;
  const schemaResponse = await fetch(`${apiOrigin}/api/v3/tables/${tableId}/columns`);
  assert.equal(schemaResponse.status, 200);
  const schema = (await schemaResponse.json()).data;
  const binding = { kind: 'agent_binding', content_key: 'evaluator', content_version: 1, title: 'Browser test rules', status: 'active', payload: { evaluator: 'rules' } };
  for (const [key, value] of Object.entries(binding)) {
    const col = schema.find((column) => (column.name ?? column.column_name) === key);
    assert.ok(col, `Missing schema field ${key}`);
    assert.ok(value !== null && value !== undefined);
    assert.ok(['text', 'number', 'integer', 'json', 'jsonb', 'select'].includes(col.column_type), `Unexpected ${key} type ${col.column_type}`);
  }
  for (const col of schema.filter((column) => column.is_required)) {
    assert.ok(Object.hasOwn(binding, col.name ?? col.column_name) || col.default_value != null);
  }
  await writeFile(join(artifacts, 'fixture-binding-schema.json'), JSON.stringify(schema, null, 2));
  const seeded = await fetch(`${apiOrigin}/api/v3/tables/${tableId}/rows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: binding }) });
  assert.equal(seeded.status, 201, await seeded.text());
  vite = await createServer({ root, configFile: false, envFile: false, cacheDir: join(artifacts, 'vite-cache'),
    resolve: { alias: { '@': join(root, 'src') }, dedupe: ['react', 'react-dom'] }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: [entry], include: ['react', 'react-dom/client', 'react/jsx-runtime'], holdUntilCrawlEnd: true },
    server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': apiOrigin, '/fixture': apiOrigin } },
  });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', async (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    if (response.url().includes('/neo16/worlds')) worldReplies.push(await response.json());
  });
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.origin, origin, 'Browser must never access production or external services');
    if (url.pathname.startsWith('/api')) requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
    assert.ok(!url.pathname.includes('socket.io'), 'Installed town must not connect legacy multiplayer');
    await route.continue();
  });
  await page.goto(`${origin}/${entry}`);
  await page.getByRole('group', { name: 'Town map' }).waitFor();
  await vite.waitForRequestsIdle();
  await page.reload();
  await page.getByRole('group', { name: 'Town map' }).waitFor();
  await page.getByRole('button', { name: 'Move to 2, 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Your position"]')?.textContent?.includes('2.0, 1.0'));
  await page.getByRole('button', { name: /Approach Nora/ }).click();
  await page.getByRole('button', { name: /Talk to Nora/ }).click();
  await page.getByRole('dialog', { name: 'Quest conversation' }).waitFor();
  assert.equal(await page.getByLabel('Talk to', { exact: true }).inputValue(), 'nora');
  for (const message of ['When is she free?', 'Where should I meet her?']) {
    await page.getByLabel('Your message').fill(message);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByLabel('Your message').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[aria-label="Your message"]')?.value === '');
  }
  await page.getByLabel('Talk to', { exact: true }).selectOption('reed');
  await page.getByLabel('Your message').fill('Thursday at two in Lab B works for me.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByTestId('notice-completed').waitFor();
  assert.match(await page.getByTestId('xp').innerText(), /50 XP/);
  const startCount = requests.filter((r) => r.path.endsWith('/sessions') && r.method === 'POST').length;
  await page.screenshot({ path: join(artifacts, 'desktop-completed.png'), fullPage: true });
  await page.reload();
  await page.getByRole('group', { name: 'Town map' }).waitFor();
  await page.getByRole('button', { name: 'Quest', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="session-status"]')?.textContent?.includes('completed'));
  assert.match(await page.getByTestId('xp').innerText(), /50 XP/);
  assert.equal(await page.locator('[data-testid^="turn-"]').count(), 3);
  assert.equal(requests.filter((r) => r.path.endsWith('/sessions') && r.method === 'POST').length, startCount);
  await page.keyboard.press('Escape');
  assert.ok(await page.getByRole('button', { name: 'Quest', exact: true }).evaluate((el) => el === document.activeElement));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core') });
  const townAccessibility = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
  await writeFile(join(artifacts, 'town-accessibility.json'), JSON.stringify(townAccessibility, null, 2));
  await page.screenshot({ path: join(artifacts, 'mobile-town.png'), fullPage: true });
  await page.getByRole('button', { name: 'Quest', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(artifacts, 'mobile-completed.png'), fullPage: true });
  const dialogAccessibility = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
  await writeFile(join(artifacts, 'dialog-accessibility.json'), JSON.stringify(dialogAccessibility, null, 2));
  assert.deepEqual(townAccessibility.map((v) => v.id), [], 'Town accessibility violations');
  assert.deepEqual(dialogAccessibility.map((v) => v.id), [], 'Dialog accessibility violations');
  const unnamed = await page.locator('dialog button').evaluateAll((buttons) => buttons.filter((el) => !el.textContent.trim() && !el.getAttribute('aria-label')).length);
  assert.equal(unnamed, 0);
  assert.deepEqual(errors, []);
  assert.ok(requests.some((r) => r.body?.data?.command === 'move'));
  assert.ok(requests.some((r) => r.body?.data?.command === 'heartbeat'));
  const summary = { database: target, evaluator: 'rules (fixture only)', browser: 'Chromium', ui: 'enter → move → approach → dialogue → reload → 50 XP + 3 turns restored', requests: requests.length, errors, artifacts };
  await writeFile(join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(artifacts, 'requests.json'), JSON.stringify(requests, null, 2));
  await writeFile(join(artifacts, 'world-replies.json'), JSON.stringify(worldReplies, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ message: error.message, errors, requests }, null, 2));
  if (page) await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ message: error.message, errors }));
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await new Promise((resolve) => http ? http.close(resolve) : resolve());
  if (installed) await uninstallModule({ moduleKey: 'neo16', spaceId: ws.spaceId, purge: true, userId: ws.userId });
  if (ws) await ws.cleanup();
  await destroyAdapter();
  console.log(`Artifacts: ${artifacts}`);
}
