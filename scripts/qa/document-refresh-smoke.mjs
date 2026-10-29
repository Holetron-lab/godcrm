import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'document-refresh-23084-'));
const entry = 'src/tests/document-refresh-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Open document' });
    const fixture = await openFixture({ server, page, entry, ready: opener });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    const paragraph = dialog.getByText('Selected paragraph', { exact: true });
    const original = await paragraph.elementHandle();
    const table = dialog.getByRole('table');
    const tableNode = await table.elementHandle();
    await table.hover();
    await page.mouse.wheel(400, 0);
    await expect.poll(() => table.evaluate(el => el.parentElement.scrollLeft)).toBeGreaterThanOrEqual(400);
    await page.waitForTimeout(500); // Let Chromium finish the wheel gesture before sampling retention.
    const scrollLeft = await table.evaluate(el => el.parentElement.scrollLeft);
    await paragraph.click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    assert.equal(selected, 'Selected paragraph');
    const tick = Number(await page.getByLabel('Background updates').textContent());
    for (let sample = 0; sample < 12; sample++) {
      await page.waitForTimeout(1000);
      assert.ok(await original.evaluate(el => el.isConnected));
      assert.ok(await tableNode.evaluate(el => el.isConnected));
      assert.equal(await table.evaluate(el => el.parentElement.scrollLeft), scrollLeft);
      assert.equal(await page.evaluate(() => window.getSelection().toString().trim()), selected);
    }
    assert.ok(Number(await page.getByLabel('Background updates').textContent()) >= tick + 10);
    await page.screenshot({ path: join(artifacts, `retained-${width}.png`) });
    await dialog.getByTitle('Light background').click();
    await expect(dialog.getByRole('heading', { name: 'Document', level: 1 })).toHaveClass(/text-gray-900/);
    await dialog.getByRole('button', { name: 'Update content' }).click();
    await expect(dialog.getByRole('heading', { name: 'Updated document', level: 1 })).toBeVisible();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id }) => id));
    assert.deepEqual(violations, []);
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await fixture.assertStable();
    console.log(`PASS ${width}: 12s updates, DOM/selection/table scroll retained, content/theme/keyboard/axe`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
