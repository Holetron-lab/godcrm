import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'parent-delete-'));
const entry = 'src/tests/parent-delete-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const kind of ['project', 'space', 'space-card']) {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const opener = kind === 'space-card' ? page.getByRole('button', { name: 'Actions Example' }) : page.getByTitle('Actions', { exact: true });
      await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready: opener, timeout: 60_000 });
      const entity = kind === 'project' ? 'project' : 'space';
      const message = entity === 'project' ? 'Remove tables and dashboards before deleting this project' : 'Remove projects and dashboards before deleting this space';
      let requests = 0;
      // Fulfil locally: no real API or DB writes. Still exercise apiClient and the real mutation hooks.
      await page.route(`**/api/v3/${entity}s/42`, async route => {
        assert.equal(route.request().method(), 'DELETE');
        requests++;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: `${entity.toUpperCase()}_NOT_EMPTY`, message } }) });
      });
      const unexpectedErrors = [];
      page.on('pageerror', error => unexpectedErrors.push(error.message));
      page.on('console', event => {
        if (event.type() === 'error' && !event.text().includes('409 (Conflict)') && !event.text().includes(`Failed to delete ${entity}:`)) unexpectedErrors.push(event.text());
      });
      const selectDelete = async () => {
        await opener.focus();
        await page.keyboard.press('Enter');
        const item = kind === 'space-card' ? page.getByRole('menuitem', { name: 'Delete', exact: true }) : page.getByRole('button', { name: `Delete ${entity === 'project' ? 'Project' : 'Workspace'} Example` });
        await item.focus();
        await page.keyboard.press('Enter');
      };
      await selectDelete();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const input = page.getByRole('textbox', { name: /To confirm deletion, type delete below/ });
      await input.fill('delete');
      await page.getByRole('button', { name: /Delete Forever/ }).click();
      await expect(page.getByRole('alert')).toHaveText(message);
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await expect(page.getByLabel('Location')).toHaveText('/original');
      assert.equal(requests, 1);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
      await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
      await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
      assert.deepEqual(violations.map(({ id }) => id), []);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await selectDelete();
      await expect(input).toHaveValue('');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(opener).toBeFocused();
      assert.deepEqual(unexpectedErrors, []);
      await page.close();
      process.stdout.write(`${kind} ${width} ${theme}: refusal, focus, axe PASS\n`);
    }
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
