import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'column-menu-'));
const entry = 'src/tests/column-menu-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390 });
    const trigger = page.getByRole('button', { name: 'Действия столбца Название' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: trigger });
    const handle = page.getByRole('button', { name: 'Переместить столбец Название' });
    const name = page.getByRole('button', { name: 'Название', exact: true });
    const sort = page.getByRole('button', { name: 'Сортировать по Название' });
    await expect(handle).toHaveText('📝');
    await expect(handle).toHaveCSS('opacity', '1');
    await expect(handle).toHaveCSS('touch-action', 'none');
    await expect(sort).toBeVisible();
    const handleBounds = await handle.boundingBox();
    const nameBounds = await name.boundingBox();
    const sortBounds = await sort.boundingBox();
    assert.ok(handleBounds.x + handleBounds.width <= nameBounds.x && nameBounds.x + nameBounds.width <= sortBounds.x, 'Sort arrow follows emoji and name without overlap');
    await handle.click();
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Готово');
    await name.click();
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Настройки Название');
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Настройки Название');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-handle.png`), fullPage: true });
    await sort.click();
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Сортировка');
    // With no data rows TanStack starts with descending order.
    await expect(sort.locator('svg.lucide-arrow-down')).toHaveCount(1);
    await sort.focus();
    await page.keyboard.press('Enter');
    await expect(sort.locator('svg.lucide-arrow-up')).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(sort.locator('svg.lucide-arrow-up-down')).toHaveCount(1);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Вправо Название');
    await expect(trigger).toBeFocused();
    for (const [action, status] of [['Настройки', 'Настройки Название'], ['Добавить столбец слева', 'left Название'], ['Добавить столбец справа', 'right Название']]) {
      await trigger.click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
      await expect(page.getByRole('status', { name: 'Результат' })).toHaveText(status);
    }
    await trigger.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    // Audit the modal menu itself, then the whole document after Radix releases its focus trap.
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role=menu]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    const box = await page.getByRole('menu').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'Menu stays within viewport');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    const closedViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-closed-axe.json`), JSON.stringify(closedViolations, null, 2));
    assert.deepEqual(closedViolations.map(({ id }) => id), []);
    assert.equal(await trigger.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    const header = page.getByRole('columnheader').first();
    const before = await header.boundingBox();
    const resize = await page.locator('[title="Drag to resize"]').first().boundingBox();
    await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
    await page.mouse.down();
    await page.mouse.move(resize.x + 35, resize.y + resize.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.ok((await header.boundingBox()).width > before.width, 'Column resizing remains available');
    await handle.scrollIntoViewIfNeeded();
    await trigger.hover();
    await handle.hover();
    const from = await handle.boundingBox();
    const current = await header.boundingBox();
    const next = await page.getByRole('columnheader').nth(1).boundingBox();
    const dragDistance = next.x + next.width / 2 - (current.x + current.width / 2);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + dragDistance, from.y + from.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Перемещено');
    await expect(page.getByRole('columnheader').nth(1)).toContainText('Название');
    await page.waitForTimeout(300);
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[id^=DndLiveRegion]')).toContainText('moved over droppable area 0');
    // Wait for the header's activation animation before measuring the next target.
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowLeft');
    if (width === 390) {
      // On a narrow viewport the first arrow can scroll the previous column into view.
      await page.waitForTimeout(350);
    await page.keyboard.press('ArrowLeft');
    }
    await expect(page.locator('[id^=DndLiveRegion]')).toContainText('moved over droppable area 1');
    await page.keyboard.press('Space');
    await expect(page.getByRole('columnheader').first()).toContainText('Название');
    if (width === 390) {
      await handle.scrollIntoViewIfNeeded();
      const touchFrom = await handle.boundingBox();
      const touchTarget = await page.getByRole('columnheader').nth(1).boundingBox();
      const client = await page.context().newCDPSession(page);
      const x = touchFrom.x + touchFrom.width / 2;
      const y = touchFrom.y + touchFrom.height / 2;
      const targetX = Math.min(width - 20, touchTarget.x + touchTarget.width / 2);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(250);
      for (let step = 1; step <= 12; step++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (targetX - x) * step / 12, y }] });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.getByRole('columnheader').nth(1)).toContainText('Название');
      await expect(page.getByRole('status', { name: 'Результат' })).toHaveText('Перемещено');
      await client.detach();
      // Let dnd-kit's post-drag click suppression and the drop transition finish.
      await page.waitForTimeout(300);
    }
    await page.getByRole('checkbox', { name: 'Только чтение' }).check();
    await expect(page.getByRole('button', { name: /Переместить столбец/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Действия столбца/ })).toHaveCount(0);
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: emoji drag, name settings, sort cycle, menu, keyboard, focus, readonly, axe${width === 390 ? ', touch' : ''} PASS`);
  }
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await server.close();
}
