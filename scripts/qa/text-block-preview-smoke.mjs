import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'text-block-preview-'));
const entry = 'src/tests/text-block-preview-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const edit = page.getByRole('button', { name: 'Редактировать текстовый блок' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: edit });
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    assert.equal(await edit.evaluate(el => getComputedStyle(el, '::after').outlineStyle), 'solid');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-focus.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    // Hit the body of the card, outside the button's visible header.
    const body = await page.getByText('Инструкция к заявке:', { exact: false }).boundingBox();
    assert.ok(body);
    await page.mouse.click(body.x + 8, body.y + body.height / 2);
    await expect(page.getByLabel('События')).toHaveText('select,select,select');
    await edit.focus();
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: 'Справка', exact: true });
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#help$/);
    await link.click();
    await expect(page.getByLabel('События')).toHaveText('select,select,select');
    await expect(page.getByRole('region', { name: 'Предпросмотр' }).getByRole('button')).toHaveCount(0);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document,
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: keyboard, focus, body click, links, form safety, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
