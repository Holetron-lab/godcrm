import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'select-tags-'));
const entry = 'src/tests/select-tags-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
const serialize = (values, format) => format === 'json' ? JSON.stringify(values)
  : values.join(format === 'semicolon' ? '; ' : format === 'newline' ? '\n' : ', ');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const format of ['comma', 'json', 'semicolon', 'newline']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Открыть', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&format=${format}`, ready: opener });
    await opener.click();
    const search = page.getByPlaceholder('Поиск...');
    await search.focus();
    await page.keyboard.press('Tab');
    const alpha = page.getByRole('button', { name: 'Удалить Альфа', exact: true });
    await expect(alpha).toBeFocused();
    assert.notEqual(await alpha.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run({ include: [['button[aria-label^="Удалить "]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-${format}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${format}.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Значение', { exact: true })).toHaveText(serialize(['beta', 'legacy'], format));
    await expect(page.getByLabel('События')).toHaveText('change');
    await expect(search).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Удалить Бета', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('События')).toHaveText('change,change');
    await expect(search).toBeFocused();
    await page.getByRole('button', { name: 'Удалить legacy', exact: true }).click();
    await expect(page.getByLabel('Значение', { exact: true })).toHaveText(serialize([], format));
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('События')).toHaveText('change,change,change,cancel');
    await expect(page.getByLabel('Значение', { exact: true })).toHaveText(serialize(['alpha', 'beta', 'legacy'], format));
    await opener.click();
    await page.getByRole('button', { name: 'Удалить Бета', exact: true }).click();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(page.getByLabel('Сохранено')).toHaveText(serialize(['alpha', 'legacy'], format));
    await expect(page.getByLabel('События')).toHaveText('change,change,change,cancel,change,commit');
    await opener.click();
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(alpha).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(alpha).toHaveCount(0);
    await expect(page.getByLabel('События')).toHaveText('change,change,change,cancel,change,commit,cancel');
    await expect(page.getByLabel('Сохранено')).toHaveText(serialize(['alpha', 'legacy'], format));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme} ${format}: keyboard, pointer, focus, cancel/save, scoped axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
