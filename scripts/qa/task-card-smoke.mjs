import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'task-card-'));
const entry = 'src/tests/task-card-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const expand = page.getByRole('button', { name: 'Подробности: Проверить карточку' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: expand });
    const complete = page.getByRole('button', { name: 'Выполнено: Проверить карточку' });
    await page.keyboard.press('Tab');
    await expect(complete).toBeFocused();
    await page.keyboard.press('Space');
    await expect(complete).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(expand).toBeFocused();
    assert.notEqual(await expand.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    await page.getByText('5', { exact: true }).click();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    const palette = page.getByRole('button', { name: 'Изменить цвет' });
    await palette.click();
    await page.getByRole('button', { name: 'Цвет #f97316' }).focus();
    await page.keyboard.press('Space');
    await expect(palette).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Открыть', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expand.focus();
    await page.keyboard.press('Space');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.dblclick();
    await expect(page.getByLabel('События')).toHaveText('color:#f97316,details,comments,details');
    const empty = page.getByRole('button', { name: 'Подробности: Без дополнительных полей' });
    await empty.click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByLabel('События')).toHaveText('color:#f97316,details,comments,details,empty:details,empty:comments');
    await expand.click();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('form', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: keyboard, focus, content, palette, callbacks, no submit, axe PASS`);
  }
} finally { await browser?.close(); await server.close(); console.log(`Artifacts: ${artifacts}`); }
