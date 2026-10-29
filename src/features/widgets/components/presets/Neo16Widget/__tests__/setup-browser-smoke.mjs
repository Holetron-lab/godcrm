// Browser contract/a11y smoke with intercepted HTTP; no database or live AI.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const entry = 'src/features/widgets/components/presets/Neo16Widget/__tests__/browser/setup.html';
const artifacts = await mkdtemp('/tmp/neo16-setup-browser-');
const widget = { id: 4376, dashboard_id: 7739, title: 'Neo16', config: {} };
const requests = []; const errors = [];
let browser; let vite;
try {
  vite = await createServer({ root, configFile: false, envFile: false, cacheDir: join(artifacts, 'cache'),
    resolve: { alias: { '@': join(root, 'src') }, dedupe: ['react', 'react-dom'] }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: [entry] }, server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => errors.push(error.message));
  let installed = false;
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.origin, origin, 'No external requests');
    if (url.pathname === '/fixture/widget') return route.fulfill({ json: widget });
    if (!url.pathname.startsWith('/api')) return route.continue();
    requests.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
    const reply = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === '/api/v3/dashboards/7739') return reply({ space_id: 7829, project_id: null });
    if (url.pathname === '/api/v3/projects') return reply([{ id: 8427, space_id: 7829, name: 'Город' }]);
    if (url.pathname === '/api/v3/spaces') return reply([{ id: 7829, name: 'Space', owner_id: 1, user_access_level: 'owner_owner' }]);
    if (url.pathname === '/api/v3/neo16/widgets/4376/install') {
      const dryRun = request.postDataJSON().data.dry_run;
      if (!dryRun) installed = true;
      return reply({ dry_run: dryRun,
        plan: { tables: [{ name: 'neo16_worlds', action: 'create', columns_added: ['state'] }], seed: [], conflicts: [],
          widgets: [{ widget_id: 4376, dashboard_id: 7739, action: 'adopt' }] },
        npc_agents: { tables: [{ name: 'AI Agents', action: 'existing', columns_added: [] }],
          agents: [{ npc_key: 'nora', action: 'create' }], operator: { provider: 'codex', action: 'existing' } },
      });
    }
    if (url.pathname === '/api/v3/widgets/4376') { assert.ok(installed); return reply({ ...widget, config: { __module: { key: 'neo16' } } }); }
    if (url.pathname === '/api/v3/neo16/worlds') return reply({ learner_player_id: 'p1', world_id: 1, state_version: 1, simulated_at: null,
      snapshot: { worldMap: { width: 16, height: 16, tileDim: 16, bgTiles: [], objectTiles: [] }, playerDescriptions: [],
        world: { agents: [], players: [{ id: 'p1', position: { x: 1, y: 1 }, facing: { dx: 1, dy: 0 }, speed: 1 }] } }, npcs: [] });
    if (url.pathname === '/api/v3/neo16/sessions') return reply({ session_id: 1, world_id: 1, resumed: false, progress_id: 1,
      state: { session: { id: 1, status: 'active', state_version: 1, goals_done: [] },
        quest: { id: 1, key: 'arrange_meeting', version: 1, title: 'Meeting', npcs: [], goals: [] },
        turns: [], progress: { id: 1, status: 'in_progress', xp: 0 } } });
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  await page.goto(`${origin}/${entry}`);
  await page.getByLabel('Проект для данных города').selectOption('8427');
  assert.equal(requests.filter((r) => r.method === 'POST').length, 0);
  await page.getByRole('button', { name: 'Посмотреть изменения' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Подтвердить установку' }).waitFor();
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core') });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
  await writeFile(join(artifacts, 'accessibility.json'), JSON.stringify(violations, null, 2));
  assert.deepEqual(violations.map((v) => v.id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(artifacts, 'mobile-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(artifacts, 'desktop-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Подтвердить установку' }).click();
  await page.getByLabel('Neo16 town').waitFor();
  await page.getByRole('group', { name: 'Town map' }).waitFor();
  assert.equal(requests.filter((r) => r.path.endsWith('/install')).length, 2);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'summary.json'), JSON.stringify({ result: 'PASS', backend: 'intercepted fixture', violations, errors, requests }, null, 2));
  console.log(`PASS: keyboard preview/apply, retained widget ID, desktop/mobile, axe; ${artifacts}`);
} finally { await browser?.close(); await vite?.close(); }
