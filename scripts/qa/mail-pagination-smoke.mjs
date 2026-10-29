import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'mail-pagination-'));
const entry = 'src/tests/mail-accessibility-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry: `${entry}?kind=pagination`,
      ready: page.getByRole('button', { name: 'Message 1', exact: true }), timeout: 60_000 });
    const rows = page.getByRole('checkbox', { name: 'Select message from Sender' });
    await expect(rows).toHaveCount(50);
    await page.getByRole('button', { name: 'Message 50', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить следующие письма.');
    await expect(rows).toHaveCount(50);
    const retry = page.getByRole('button', { name: 'Повторить загрузку' });
    await retry.focus();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('main .overflow-auto > div', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(73);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Загрузить ещё' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Message 73', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `page-73-${width}.png`) });
    await page.getByRole('textbox', { name: 'Search mail' }).fill('Message 73');
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Message 73', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, loaded: 73, retry: 'PASS', accessibility: 'PASS' }) + '\n');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
