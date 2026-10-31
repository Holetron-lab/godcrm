import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const artifacts = await mkdtemp(join(tmpdir(), 'document-text-editor-'));
const entry = 'src/tests/document-text-editor-fixture/index.html';
const server = await createFixtureServer({ root: process.cwd(), artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const size of [12, 20]) for (const kind of ['short', 'long']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => localStorage.setItem('god-crm-language', 'ru'));
    page.on('pageerror', error => process.stderr.write(`${error.stack}\n`));
    const block = page.locator('#item-1');
    const preview = block.locator('.markdown-preview p').first();
    const fixture = await openFixture({ server, page, entry: `${entry}?size=${size}&kind=${kind}&theme=${size === 12 ? 'light' : 'dark'}`, ready: preview });
    assert.equal(await page.getByRole('button', { name: 'Редактировать текст', exact: true }).textContent(), '');
    const before = await preview.evaluate(el => {
      const css = getComputedStyle(el);
      return { fontSize: css.fontSize, fontFamily: css.fontFamily, lineHeight: css.lineHeight,
        height: el.closest('[id^="item-"]').getBoundingClientRect().height };
    });
    const original = await page.getByLabel('Сохранённый текст').textContent();
    await preview.click();
    const editor = block.locator('textarea');
    await expect(editor).toBeFocused();
    const during = await editor.evaluate(el => {
      const css = getComputedStyle(el);
      return { fontSize: css.fontSize, fontFamily: css.fontFamily, lineHeight: css.lineHeight,
        height: el.closest('[id^="item-"]').getBoundingClientRect().height };
    });
    assert.deepEqual(during, before, 'Editing must preserve typography and block height');
    await writeFile(join(artifacts, `${width}-${size}-${kind}-geometry.json`), JSON.stringify({ before, during }, null, 2));
    await page.addScriptTag({ content: await readFile(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('#item-1',
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${size}-${kind}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${size}-${kind}.png`), fullPage: true });
    await editor.fill('Изменённый текст\n'.repeat(30));
    assert.equal(await block.evaluate(el => el.getBoundingClientRect().height), before.height);
    assert.ok(await editor.evaluate(el => el.scrollHeight > el.clientHeight), 'Long source scrolls inside the fixed block');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(page.getByLabel('Сохранённый текст')).toHaveText(original);
    await expect(page.getByLabel('Сохранения')).toBeEmpty();
    await preview.click();
    await editor.fill('Сохранение по Ctrl+Enter');
    await page.keyboard.press('Control+Enter');
    await expect(editor).toHaveCount(0);
    await expect(page.getByLabel('Сохранённый текст')).toHaveText('Сохранение по Ctrl+Enter');
    await expect(page.getByLabel('Сохранения')).toHaveText('save');
    await preview.click();
    await editor.fill('Сохранение при потере фокуса');
    await page.getByRole('button', { name: 'После блока' }).click();
    await expect(page.getByLabel('Сохранённый текст')).toHaveText('Сохранение при потере фокуса');
    await expect(page.getByLabel('Сохранения')).toHaveText('save,save');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width}px font ${size}px ${kind}: typography, height, scroll, cancel, save PASS\n`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const preview = page.locator('#item-1 .markdown-preview p').first();
  const fixture = await openFixture({ server, page, entry: `${entry}?readonly=true`, ready: preview });
  await preview.click();
  await expect(page.locator('#item-1 textarea')).toHaveCount(0);
  await expect(page.locator('#item-1 button')).toHaveCount(0);
  await fixture.assertStable();
  process.stdout.write('Read-only document: no editor or editing actions PASS\n');
  await page.close();
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
