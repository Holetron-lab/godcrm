import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'preview-dialogs-'));
const entry = 'src/tests/preview-dialogs-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const kind of (process.env.PREVIEW_CASES || 'file,attachment,markdown,nested,json').split(',')) {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const opener = page.getByRole('button', { name: 'Открыть', exact: true });
      const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready: opener, timeout: 60_000 });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      assert.ok(await dialog.getAttribute('aria-labelledby'));
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      // Both ends of the focus order must wrap inside the modal.
      const controls = dialog.locator('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])');
      await controls.first().focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await controls.last().focus();
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
      await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations.map(({ id }) => id), []);
      await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page.getByLabel('События')).toHaveText('close');
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      await dialog.click({ position: { x: 5, y: 5 } });
      await expect(dialog).toBeVisible();
      // Full-screen mobile layouts deliberately have no exposed backdrop.
      if (width === 1440) {
        await page.mouse.click(2, 2);
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await opener.click();
      }
      if (kind === 'file') {
        await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
        await dialog.locator('textarea').fill('Несохранённая правка');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('textarea')).toHaveCount(0);
        await expect(dialog).toContainText('Исходное содержимое');
        await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
        await dialog.locator('textarea').fill('Сохранённая правка');
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toContainText('Сохранённая правка');
      }
      if (kind === 'json') {
        await dialog.getByRole('button', { name: 'Объект { }', exact: true }).click();
        await page.keyboard.press('Control+Enter');
        await expect(dialog).toHaveCount(0);
        await expect(page.getByLabel('Сохранено')).toHaveText('{}');
        await expect(opener).toBeFocused();
        await opener.click();
        await dialog.getByRole('button', { name: 'Код', exact: true }).click();
        const editor = dialog.locator('.monaco-editor textarea');
        await editor.waitFor({ state: 'visible' });
        await dialog.locator('.view-lines').click();
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
        await expect(page.getByLabel('Черновик')).toHaveText('');
        await page.keyboard.type('42', { delay: 100 });
        await expect(page.getByLabel('Черновик')).toHaveText('42');
        await page.keyboard.press('Control+Enter');
        await expect(dialog).toHaveCount(0);
        assert.equal(JSON.parse(await page.getByLabel('Сохранено').textContent()), 42);
        await expect(opener).toBeFocused();
        await opener.click();
      }
      const close = dialog.getByRole('button', { name: /^(Закрыть|Close)$/ });
      await page.keyboard.press('Tab');
      await close.focus();
      assert.notEqual(await close.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      const bounds = await close.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'Close button must be visible without horizontal scrolling');
      await page.keyboard.press('Space');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await fixture.assertStable();
      process.stdout.write(`${kind} ${width} ${theme}: dialog, keyboard, focus, backdrop, axe PASS\n`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const opener = page.getByRole('button', { name: 'Открыть', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&stack=1`, ready: opener, timeout: 60_000 });
    await opener.click();
    const topDialog = page.getByRole('dialog');
    await expect(topDialog).toHaveCount(1);
    await expect(topDialog).not.toContainText('Родительское окно');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Родительское окно', exact: true })).toBeVisible();
    await expect(opener).toBeFocused();
    await expect(page.getByLabel('События')).toHaveText('close');
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`${kind}: nested dialog Escape and focus restoration PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
