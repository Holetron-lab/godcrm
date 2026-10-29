import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const artifacts = await mkdtemp(join(tmpdir(), 'markdown-cell-smoke-'));
const entry = 'src/tests/markdown-cell-fixture/index.html';
const server = await createFixtureServer({ root: process.cwd(), artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const cell = page.locator('tbody td').first();
    const fixture = await openFixture({ server, page, entry, ready: cell });
    const original = await cell.innerText();
    await cell.locator('span').first().click();
    const field = page.getByRole('textbox', { name: 'Работа, строка 1' });
    const metrics = await field.evaluate(el => {
      const css = getComputedStyle(el);
      const td = el.closest('td');
      const tdCss = getComputedStyle(td);
      return {
        width: el.getBoundingClientRect().width,
        available: td.clientWidth - parseFloat(tdCss.paddingLeft) - parseFloat(tdCss.paddingRight),
        height: el.clientHeight, contentHeight: el.scrollHeight,
        lineHeight: parseFloat(css.lineHeight), focused: document.activeElement === el,
        overflow: document.documentElement.scrollWidth > innerWidth,
        spacing: css.getPropertyValue('--spacing-6').trim(),
        theme: css.getPropertyValue('--bg-primary').trim(),
      };
    });
    assert.ok(metrics.spacing && metrics.theme, 'App CSS tokens loaded');
    assert.ok(metrics.focused);
    assert.ok(Math.abs(metrics.width - metrics.available) <= 2, 'Uses full cell width');
    assert.ok(metrics.height > metrics.lineHeight * 2, 'Long text wraps into multiple lines');
    assert.ok(metrics.contentHeight <= metrics.height + 1, 'All content fits');
    assert.equal(metrics.overflow, false);
    await page.screenshot({ path: join(artifacts, `${width}-editing.png`), fullPage: true });
    const initialHeight = metrics.height;
    await field.fill(original.repeat(3));
    assert.ok(await field.evaluate(el => el.clientHeight > 0 && el.scrollHeight <= el.clientHeight + 1));
    assert.ok((await field.boundingBox()).height > initialHeight, 'Grows while typing');
    await field.fill('Коротко');
    assert.ok((await field.boundingBox()).height < initialHeight, 'Shrinks after deleting');
    await field.press('Escape');
    assert.equal(await cell.innerText(), original);
    await cell.locator('span').first().click();
    await field.fill('Изменённый текст');
    await field.press('Tab');
    const next = page.getByRole('textbox', { name: 'Результат, строка 1' });
    await next.waitFor();
    assert.ok(await next.evaluate(el => el === document.activeElement));
    await next.press('Escape');
    assert.equal(await cell.innerText(), 'Изменённый текст');
    await cell.locator('span').first().click();
    await field.fill('Первая строка\nВторая строка');
    await field.press('Enter');
    await field.waitFor({ state: 'detached' });
    assert.equal(await cell.innerText(), 'Первая строка Вторая строка');
    assert.equal((await page.getByTestId('saved').innerText()).split('\n').length, 3);
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ viewport: width, metrics, editing: 'PASS', keyboard: 'PASS', stable: true }) + '\n');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
