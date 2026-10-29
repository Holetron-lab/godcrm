import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'import-upload-'));
const entry = 'src/tests/import-upload-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
const content = JSON.stringify({ version: '1', tableName: 'Keyboard import', columns: [], rows: [] });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const kind of ['unified', 'json']) for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Open import' });
    const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready: opener });
    await opener.click();
    const input = page.locator('input[type=file]');
    // Reach the upload control with keyboard navigation, without focusing it programmatically.
    for (let tabs = 0; tabs < 10 && !await input.evaluate(el => el === document.activeElement); tabs++) await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await expect(input).toHaveAccessibleName('Выбрать JSON файл');
    assert.notEqual(await input.locator('..').evaluate(el => getComputedStyle(el).boxShadow), 'none');
    for (const key of ['Enter', 'Space']) {
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press(key);
      await chooser; // Dismiss/cancel: no change event, no value selected.
    }
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role=dialog]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
    const chooser = page.waitForEvent('filechooser');
    await input.click();
    await (await chooser).setFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(page.getByText('Этот файл не похож на экспорт GOD CRM', { exact: true })).toBeVisible();
    await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await expect(page.getByText('Keyboard import', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await opener.click();
    const dataTransfer = await page.evaluateHandle(text => { const data = new DataTransfer(); data.items.add(new File([text], 'drop.json', { type: 'application/json' })); return data; }, content);
    await input.dispatchEvent('dragover', { dataTransfer });
    await input.dispatchEvent('drop', { dataTransfer });
    await expect(page.getByText('Keyboard import', { exact: true })).toBeVisible();
    await dataTransfer.dispose();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (kind === 'unified') {
      await opener.click();
      await page.getByRole('button', { name: 'CSV', exact: true }).click();
      await expect(input).toHaveAttribute('accept', '.csv,text/csv');
      await expect(input).toHaveAccessibleName('Выбрать CSV файл');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${kind} ${width} ${theme}: keyboard, pointer, validation, preview, drop, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
