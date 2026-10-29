import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'column-options-22013-'));
const entry = 'src/tests/column-options-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const language = theme === 'light' ? 'ru' : 'en';
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const collect = page.getByRole('button', { name: language === 'ru' ? /Собрать из всей таблицы/ : /Collect from entire table/ });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&language=${language}`, ready: collect });
    const colors = page.getByRole('textbox', { name: language === 'ru' ? 'Цвет в формате HEX' : 'Color in HEX format' });
    for (const color of await colors.all()) {
      const bounds = await color.boundingBox();
      assert.equal(bounds.width, 80);
      assert.equal(bounds.height, 40);
    }
    const field = await page.getByRole('textbox', { name: language === 'ru' ? 'Название' : 'Label', exact: true }).first().locator('..').boundingBox();
    const color = await colors.first().boundingBox();
    if (width > 768) assert.equal(color.y, field.y);
    await page.getByRole('button', { name: language === 'ru' ? 'Выбрать цвет' : 'Choose color', exact: true }).first().click();
    await page.getByRole('button', { name: '#ef4444', exact: true }).click();
    await expect(colors.first()).toHaveValue('#ef4444');
    await collect.focus();
    await collect.press('Enter');
    await expect(page.getByRole('button', { name: /Собираем|Collecting/ })).toBeDisabled();
    await expect(page.locator('input[value="За пределами 500"]')).toHaveCount(2);
    await expect(page.getByTestId('requests')).toHaveText('2');
    await expect(colors.first()).toHaveValue('#ef4444');
    await collect.click();
    await expect(page.getByRole('button', { name: /Собираем|Collecting/ })).toBeDisabled();
    await expect(collect).toBeEnabled();
    await expect(page.locator('input[value="За пределами 500"]')).toHaveCount(2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    assert.deepEqual(violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => node.target) })), []);

    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: 501 rows, keyboard, repeat, color layout, translations, axe PASS`);
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
