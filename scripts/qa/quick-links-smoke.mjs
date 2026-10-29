import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'quick-links-'));
const entry = 'src/tests/quick-links-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
async function tabTo(page, target) {
  for (let i = 0; i < 30; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail('Control unreachable with Tab');
}
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Configure quick links', exact: true });
    const fixture = await openFixture({ server, page, entry, ready: opener });
    await tabTo(page, opener);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Quick links', exact: true });
    await expect(dialog).toBeVisible();
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(key);
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Focus must stay in dialog');
      }
    }
    const count = dialog.getByRole('spinbutton', { name: 'Link count' });
    await count.fill('7');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    assert.equal(await page.evaluate(() => localStorage.getItem('statusbar_quick_links')), null);
    await page.keyboard.press('Space');
    await expect(count).toHaveValue('5');
    await dialog.getByRole('button', { name: 'Add link', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('<Fixture link>');
    await dialog.getByRole('textbox', { name: 'URL (e.g. /tables/123 or https://...)', exact: true }).fill('/fixture');
    await dialog.getByRole('textbox', { name: 'Icon (emoji, optional)', exact: true }).fill('🔗');
    await dialog.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(dialog.getByRole('button', { name: 'Edit <Fixture link>', exact: true })).toBeVisible();
    await count.fill('3');
    await dialog.getByRole('combobox', { name: 'Scrolling' }).selectOption('page');
    await dialog.getByRole('checkbox', { name: 'Show titles' }).uncheck();
    await page.screenshot({ path: join(artifacts, `${width}-dialog.png`), fullPage: true });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'Dialog fits viewport');
    await tabTo(page, dialog.getByRole('button', { name: 'Save', exact: true }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('statusbar_quick_links')));
    assert.deepEqual({ ...saved, links: saved.links.map(({ id, ...link }) => link) }, {
      displayCount: 3, showLabels: false, scrollMode: 'page',
      links: [{ label: '<Fixture link>', url: '/fixture', icon: '🔗' }],
    });
    await opener.click();
    await dialog.getByRole('button', { name: 'Delete <Fixture link>', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByRole('button', { name: 'Edit <Fixture link>', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.locator('div.fixed.inset-0[data-state="open"]').click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await dialog.getByRole('button', { name: 'Edit <Fixture link>', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited link');
    await dialog.getByRole('button', { name: 'Save', exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByRole('button', { name: 'Edit Edited link', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete Edited link', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(opener).toBeFocused();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('statusbar_quick_links')).links), []);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, keyboard: 'PASS', persistence: 'PASS', accessibility: 'PASS' }) + '\n');
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
