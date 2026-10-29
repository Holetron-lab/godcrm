import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'fancy-select-'));
const entry = 'src/tests/fancy-select-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const trigger = page.locator('form button').first();
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: trigger });
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const search = page.getByRole('textbox');
    await expect(search).toBeFocused();
    await search.fill('do');
    await page.keyboard.press('Tab'); // Clear selection
    await page.keyboard.press('Tab'); // Matching option
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Selected value')).toHaveText('done');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName('Default status');
    await expect(trigger).toHaveAccessibleDescription('Done');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.press('Space');
    await expect(search).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await search.fill('missing');
    await expect(page.getByText('Nothing found', { exact: true })).toBeVisible();
    await search.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('Selected value')).toHaveText('done');
    await trigger.click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByLabel('Selected value')).toHaveText('open');
    await trigger.click();
    await page.getByRole('button', { name: '— Not selected —', exact: true }).press('Enter');
    await expect(page.getByLabel('Selected value')).toHaveText('null');
    await trigger.click();
    await search.fill('do');
    await page.getByRole('heading', { name: 'Default value selection', exact: true }).click();
    await expect(search).toHaveCount(0);
    await trigger.click();
    await expect(search).toHaveValue('');
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(search).toHaveCount(0);
    await page.getByLabel('Use formula').check();
    await expect(trigger).toBeDisabled();
    await expect(page.getByLabel('Selected value')).toHaveText('null');
    await page.getByLabel('Use formula').uncheck();
    await trigger.click();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const audit = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    assert.deepEqual(audit.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await expect(page.getByLabel('Submissions')).toHaveText('0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: keyboard, pointer, clear, Escape, focus, disabled, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
