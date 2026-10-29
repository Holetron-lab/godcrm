import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'table-cell-'));
const entry = 'src/tests/table-cell-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const first = page.getByRole('region', { name: 'modal', exact: true }).getByRole('button');
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: first });
    assert.equal(await page.locator('button button').count(), 0, 'No nested buttons in real grid rows');
    let calls = 0;
    await page.keyboard.press('Tab');
    for (const mode of ['modal', 'inline', 'expand', 'embedded-modal', 'embedded-inline']) {
      const region = page.getByRole('region', { name: mode, exact: true });
      const button = region.getByRole('button');
      await expect(button).toBeFocused();
      assert.equal(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      const scroll = await page.evaluate(() => window.scrollY);
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key);
        if (mode === 'expand') {
          await expect(button).toHaveAttribute('aria-expanded', String(key === 'Enter'));
          await expect(region.getByText('Запись 5')).toHaveCount(key === 'Enter' ? 1 : 0);
        } else {
          await expect(page.getByRole('status')).toHaveText(`Opened ${++calls}: 42/parent_id/7`);
          if (mode === 'inline') await expect(button).toHaveAttribute('aria-expanded', String(key === 'Enter'));
        }
        assert.equal(await page.evaluate(() => window.scrollY), scroll, 'Activation must not scroll the page');
      }
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('button', { name: 'Снаружи' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'disabled' }).getByRole('button')).toBeDisabled();
    await first.click();
    await expect(page.getByRole('status')).toHaveText(`Opened ${++calls}: 42/parent_id/7`);
    await expect(page.getByText('Submits: 0; Edits: 0')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: real grid, keyboard/mouse, expand/collapse, no scroll/submission/edit, axe PASS`);
  }
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await server.close();
}
