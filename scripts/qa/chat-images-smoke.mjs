import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'chat-images-'));
const entry = 'src/tests/chat-images-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const trigger = page.getByRole('button', { name: 'draft.svg', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: trigger });
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
    const bounds = await trigger.boundingBox();
    assert.equal(bounds.width, 16); assert.equal(bounds.height, 16);
    const images = page.getByRole('region', { name: 'Сообщение' }).getByRole('img');
    await images.nth(0).hover();
    const overlays = page.getByRole('region', { name: 'Сообщение' }).locator('[aria-hidden="true"]').filter({ has: page.locator('svg.lucide-eye') });
    await expect(overlays.nth(0)).toHaveCSS('opacity', '1');
    await expect(overlays.nth(1)).toHaveCSS('opacity', '0');
    // Keep the eye overlay filter-free for mobile image compositing.
    await expect(overlays.nth(0).locator('svg')).toHaveCSS('filter', 'none');
    const first = await images.nth(0).boundingBox();
    const second = await images.nth(1).boundingBox();
    assert.equal(first.y, second.y, 'Narrow images share one row');
    assert.ok(second.x > first.x);
    assert.ok((await images.nth(4).boundingBox()).y > first.y, 'Overflow wraps to another row');
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const popup = page.locator('[data-radix-popper-content-wrapper] > [data-state]');
    const preview = popup.locator('img').first();
    await expect(preview).toBeVisible();
    const popupBounds = await popup.boundingBox();
    assert.ok(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= width);
    await popup.hover();
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.mouse.move(width - 1, 0);
    await trigger.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const violations = await page.evaluate(async () => (await window.axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Удалить draft.svg' }).click();
    await expect(trigger).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const recoveries = [];
    await page.route('**/uploads/fixture-protected.svg', route => {
      const authorized = route.request().headers().authorization === 'Bearer fixture-image-token';
      if (authorized) recoveries.push(route.request().url());
      // An undecodable native response exercises img.onerror without adding
      // intentional 401 console errors to the fixture's strict error checks.
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: authorized
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#476d80"/></svg>'
        : 'Session required' });
    });
    await page.getByRole('button', { name: 'Load protected image' }).click();
    const protectedThumbnail = page.getByRole('button', { name: 'protected.svg', exact: true });
    await expect(protectedThumbnail).toBeVisible();
    await expect.poll(() => protectedThumbnail.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await protectedThumbnail.click();
    const dialog = page.getByRole('dialog');
    const fullImage = dialog.getByRole('img', { name: 'protected.svg' });
    await expect(fullImage).toBeVisible();
    await expect.poll(() => fullImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    assert.equal(recoveries.length, 2, 'Thumbnail and full preview each recover through an authorized request');
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(fullImage).toHaveAttribute('style', /scale\(1\.25\)/);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-protected-preview.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(protectedThumbnail).toBeFocused();
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`${width} ${theme}: isolated hover, authorized preview, zoom, thumbnail size, hover/focus/Escape, wrapping, bounds, axe PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
