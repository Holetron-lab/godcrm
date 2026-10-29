import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'lint-cards-'));
const entry = 'src/tests/lint-cards-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const origin = server.resolvedUrls.local[0];
  for (const kind of ['vitals', 'landing']) for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      // The landing's optional web font is stubbed; no remote traffic or API writes.
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.origin === new URL(origin).origin && !url.pathname.startsWith('/api/')) return route.continue();
      errors.push(`Unexpected request: ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await page.goto(`${origin}${entry}?kind=${kind}&theme=${theme}`);
    await server.waitForRequestsIdle();
    await page.reload();
    await server.waitForRequestsIdle();
    const documentHandle = await page.locator('html').elementHandle();
    if (kind === 'vitals') {
      const weight = page.locator('form').getByRole('button', { name: /Вес/ });
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: '+ Добавить замер' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(weight).toBeFocused();
      assert.notEqual(await weight.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await weight.click();
      await expect(page.getByLabel('События')).toHaveText('weight,weight,heart_rate,weight');
      await expect(page.getByRole('region', { name: 'Только просмотр' }).getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Пустое состояние' })).toContainText('Нет записей');
    } else {
      const books = page.getByRole('button', { name: /Книги/ });
      await books.focus();
      assert.notEqual(await books.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await page.keyboard.press('Tab');
      const films = page.getByRole('button', { name: /Фильмы/ });
      await expect(films).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox')).toHaveValue('Фильм про ');
      await expect(page.getByRole('textbox')).toBeFocused();
      await books.focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('textbox')).toHaveValue('Книга про ');
      await films.click();
      await expect(page.getByRole('textbox')).toHaveValue('Фильм про ');
    }
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async kind => (await window.axe.run(
      kind === 'vitals' ? 'main' : { include: [['button:has(span)']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } },
    )).violations, kind);
    await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await documentHandle.evaluate(el => el === document.documentElement), true);
    await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    process.stdout.write(`${kind} ${width} ${theme}: keyboard, focus, click, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
