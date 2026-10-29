import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'nav-tree-toolbar-'));
const entry = 'src/tests/nav-tree-toolbar-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const trigger = page.getByRole('button', { name: lang === 'ru' ? 'Справка и инструменты' : 'Help & tools', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&lang=${lang}`, ready: trigger });
    await trigger.focus();
    // Verify keyboard reachability without depending on the toolbar button count.
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    assert.notEqual(await trigger.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(await trigger.getAttribute('aria-label'));
    await expect(dialog).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-${lang}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'Help fits viewport');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${lang}.png`), fullPage: true });
    await dialog.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    await trigger.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const outside = page.getByRole('button', { name: 'Outside', exact: true });
    await outside.click();
    await expect(dialog).toBeHidden();
    await expect(outside).toBeFocused();
    for (const name of ['Hide all', 'Sort mode (drag & drop)', 'Expand all', 'Collapse all']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await expect(page.getByLabel('Events')).toHaveText('visibility,sort,expand,collapse');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme} ${lang}: keyboard, focus, dismissal, toolbar actions, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
