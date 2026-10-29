import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'relation-cell-'));
const entry = 'src/tests/relation-cell-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const first = page.getByRole('region', { name: 'badges', exact: true }).getByRole('button');
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: first });
    let calls = 0;
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    for (const name of ['badges', 'tags', 'cards', 'Reverse', 'Nested']) {
      const button = page.getByRole('region', { name, exact: true }).getByRole('button');
      await expect(button).toBeFocused();
      if (name !== 'Nested') {
        assert.equal(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      }
      const beforeScroll = await page.evaluate(() => window.scrollY);
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key);
        const target = name === 'Reverse' ? '42/7' : name === 'Nested' ? '42/parent_id/7' : '42/7/id';
        await expect(page.getByRole('status')).toHaveText(`Opened ${++calls}: ${target}`);
        assert.equal(await page.evaluate(() => window.scrollY), beforeScroll, 'Space must not scroll the page');
      }
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('button', { name: 'Outside' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Disabled' }).getByRole('button')).toBeDisabled();
    await first.click();
    await expect(page.getByRole('status')).toHaveText(`Opened ${++calls}: 42/7/id`);
    await expect(page.getByText('Submits: 0')).toBeVisible();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: tab order, Enter/Space, no scrolling/submission, mouse, axe PASS`);
  }
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await server.close();
}
