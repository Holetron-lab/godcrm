import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'move-dialogs-'));
const entry = 'src/tests/move-dialogs-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
async function tabTo(page, target) {
  for (let i = 0; i < 20; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail('Control unreachable with Tab');
}
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry, ready: page.getByRole('button', { name: 'Open tables' }) });
    for (const kind of ['tables', 'items']) {
      await page.getByRole('button', { name: `Open ${kind}` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      if (kind === 'tables') {
        const space = dialog.getByRole('button', { name: /Test space/ });
        await tabTo(page, space);
        await page.keyboard.press('Space');
        assert.equal(await space.getAttribute('aria-expanded'), 'false');
        await page.keyboard.press('Enter');
        assert.equal(await space.getAttribute('aria-expanded'), 'true');
      }
      const project = dialog.getByRole('button', { name: 'Target project (root)', exact: true });
      await tabTo(page, project);
      await page.keyboard.press('Enter');
      assert.equal(await project.getAttribute('aria-pressed'), 'true');
      const expand = dialog.locator('button[aria-label="Target project"][aria-expanded]');
      await tabTo(page, expand);
      await page.keyboard.press('Space');
      assert.equal(await expand.getAttribute('aria-expanded'), 'true');
      const folder = dialog.getByRole('button', { name: 'Target folder', exact: true });
      await tabTo(page, folder);
      await page.keyboard.press('Space');
      assert.equal(await folder.getAttribute('aria-pressed'), 'true');
      assert.equal(await project.getAttribute('aria-pressed'), 'false');
      const nested = dialog.getByRole('button', { name: 'Nested folder', exact: true });
      await tabTo(page, nested);
      await page.keyboard.press('Enter');
      assert.equal(await nested.getAttribute('aria-pressed'), 'true');
      assert.equal(await folder.getAttribute('aria-pressed'), 'false');
      await tabTo(page, project);
      await page.keyboard.press('Space');
      assert.equal(await nested.getAttribute('aria-pressed'), 'false');
      await tabTo(page, nested);
      await page.keyboard.press('Enter');
      if (kind === 'tables') assert.ok(await dialog.getByRole('button', { name: 'Virtual group' }).isDisabled());
      assert.equal(await dialog.locator('button button').count(), 0);
      assert.equal(await dialog.getByRole('button').evaluateAll(elements => elements.filter(el => !el.textContent.trim() && !el.getAttribute('aria-label')).length), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(JSON.parse(await page.getByLabel('Moves').textContent()).length, kind === 'tables' ? 0 : 1);
      await page.screenshot({ path: join(artifacts, `${width}-${kind}.png`), fullPage: true });
      const move = dialog.getByRole('button', { name: /^(Move|Переместить)$/ });
      await tabTo(page, move);
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      const requests = JSON.parse(await page.getByLabel('Moves').textContent());
      assert.deepEqual(requests.at(-1), { operation: 'move', items: [{ type: 'table', id: 42 }], target: { project_id: 7, folder_id: 9 } });
    }
    await page.getByRole('button', { name: 'Open tables' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(JSON.parse(await page.getByLabel('Moves').textContent()).length, 2);
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, keyboard: 'PASS', payload: 'PASS', accessibility: 'PASS' }) + '\n');
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
