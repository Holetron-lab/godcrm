import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'preview-lifetime-22349-'));
const entry = 'src/tests/preview-lifetime-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const readOnly of [false, true]) {
    for (const trigger of ['resize', 'updates', 'data']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const opener = page.getByRole('button', { name: 'Open image 1' });
      const check = await openFixture({ server, page,
        entry: `${entry}?${readOnly ? 'readonly&' : ''}${trigger === 'resize' ? '' : `updates&${trigger}`}`, ready: opener });
      const original = await opener.elementHandle();
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const fullImage = dialog.getByRole('img');
      await expect.poll(() => fullImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await dialog.getByTitle('Zoom in').click();
      await dialog.getByTitle('Rotate').click();
      if (trigger === 'resize') await page.setViewportSize({ width: 390, height: 844 });
      else await expect(page.getByRole('status', { name: 'Background updates', includeHidden: true })).not.toHaveText('0');
      // Sample the actual DOM identity throughout background updates, not only
      // at the end: an unmount/reopen must not pass as retained state.
      const samples = trigger === 'resize' ? 2 : 60;
      for (let sample = 0; sample < samples; sample++) {
        await page.waitForTimeout(500);
        assert.equal(await dialog.count(), 1);
        assert.ok(await original.evaluate(el => el.isConnected));
        await expect(fullImage).toHaveAttribute('style', /scale\(1\.25\).*rotate\(90deg\)/);
      }
      if (trigger === 'resize') {
        await page.screenshot({ path: join(artifacts, `mobile-${readOnly}.png`) });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      for (const key of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
      }
      await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role=dialog]'), {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations.map(({ id }) => id));
      assert.deepEqual(violations, []);
      const retained = await dialog.count() === 1 && await original.evaluate(el => el.isConnected);
      results.push({ readOnly, trigger, retained, sampledSeconds: samples / 2, transforms: true, accessibility: 'PASS' });
      await dialog.getByTitle('Reset').click();
      await expect(fullImage).toHaveAttribute('style', /scale\(1\).*rotate\(0deg\)/);
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await page.getByRole('button', { name: 'Next image' }).click();
      await expect(page.getByRole('button', { name: 'Open image 2' })).toBeVisible();
      if (readOnly) {
        await expect(page.locator('input[type=file]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Remove image' })).toHaveCount(0);
      }
      console.log(`PASS: readonly=${readOnly}, ${trigger}`);
      await check.assertStable();
      await page.close();
    }
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ artifacts, results }));
  assert.ok(results.every(result => result.retained), 'Preview/opener must survive parent rerenders, data refresh and resize');
} finally {
  await browser?.close();
  await server.close();
}
