import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'select-options-'));
const entry = 'src/tests/select-options-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const multiple of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Открыть', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&multiple=${multiple}`, ready: opener });
    await opener.click();
    const search = page.getByRole('textbox', { name: 'Поиск опций' });
    const alpha = page.getByRole('button', { name: 'Альфа', exact: true });
    const beta = page.getByRole('button', { name: 'Бета', exact: true });
    await search.focus();
    await page.keyboard.press('Tab');
    if (multiple) {
      await expect(page.getByRole('button', { name: 'Удалить Альфа' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Удалить legacy' })).toBeFocused();
    } else {
      await expect(page.getByRole('button', { name: '— Не выбрано —' })).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(alpha).toBeFocused();
    assert.equal(await alpha.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.equal(await page.locator('button button, button div').count(), 0);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-${multiple}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${multiple}.png`), fullPage: true });
    const scroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => scrollY), scroll);
    if (multiple) {
      await expect(alpha).toHaveAttribute('aria-pressed', 'false');
      await expect(alpha).toBeFocused();
      await expect(page.getByLabel('Значение', { exact: true })).toHaveText('legacy');
      await page.keyboard.press('Tab');
      await expect(beta).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(beta).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Значение', { exact: true })).toHaveText('legacy, beta');
      await expect(page.getByLabel('События')).toHaveText('change,change');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Готово' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Сохранено')).toHaveText('legacy, beta');
      await opener.click();
      await search.fill('Альфа');
      await search.press('Enter');
      await expect(page.getByLabel('Значение', { exact: true })).toHaveText('legacy, beta, alpha');
      await alpha.focus();
      await page.keyboard.press('Escape');
      await expect(page.getByLabel('Значение', { exact: true })).toHaveText('legacy, beta');
    } else {
      await expect(page.getByLabel('Сохранено')).toHaveText('alpha');
      await opener.click();
      await beta.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Сохранено')).toHaveText('beta');
      await opener.click();
      await search.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Сохранено')).toHaveText('alpha');
    }
    await opener.click();
    await beta.click();
    if (multiple) await page.getByRole('button', { name: 'Готово' }).click();
    await expect(page.getByLabel('Сохранено')).toHaveText(multiple ? 'legacy' : 'beta');
    await expect(page.getByLabel('Отправки')).toHaveText('0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    console.log(`${width} ${theme} ${multiple ? 'multi' : 'single'}: keyboard, pointer, selected state, save/cancel, no submission/scroll, full axe PASS`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); console.log(`Artifacts: ${artifacts}`); }
