import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'table-loading-'));
const entry = 'src/tests/table-loading-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const loaded = page.getByRole('button', { name: 'Loaded row', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: loaded });
    const grid = page.getByTestId('table-grid');
    const skeletons = grid.locator('tbody tr.animate-pulse');
    await page.getByRole('button', { name: 'Start loading' }).click();
    await expect(skeletons).toHaveCount(3);
    // A real pointer click fails if a loading overlay intercepts the loaded row.
    await loaded.click({ timeout: 3000 });
    await loaded.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Clicks:' })).toHaveText('Clicks: 2');
    await expect(loaded).toBeFocused();
    assert.equal(await grid.locator('*').evaluateAll(nodes => nodes.some(node => {
      const style = getComputedStyle(node);
      return style.backdropFilter.includes('blur') && style.position === 'absolute';
    })), false, 'Loading must not blur the table');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-loading.png`), fullPage: true });
    await page.getByRole('button', { name: 'Fail loading' }).click();
    await expect(skeletons).toHaveCount(0);
    await expect(loaded).toBeVisible();
    await page.getByRole('button', { name: 'Start loading' }).click();
    await page.getByRole('button', { name: 'Complete loading' }).click();
    await expect(skeletons).toHaveCount(0);
    await expect(grid.getByTestId('table-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'New row', exact: true })).toBeVisible();
    await expect(loaded).toBeVisible();
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: pointer/keyboard during loading, skeletons, failure/completion, axe PASS`);
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
