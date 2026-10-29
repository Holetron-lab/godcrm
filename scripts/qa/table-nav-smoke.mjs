import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'table-nav-'));
const entry = 'src/tests/table-nav-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const variant of ['legacy', 'current']) for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    // Native Ctrl+Click opens a tab; keep that tab away from Vite's application fallback.
    await page.context().route('**/tables/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Native navigation target</title>',
    }));
    const tickets = page.getByRole('link', { name: 'Tickets (1708)', exact: true });
    const agents = page.getByRole('link', { name: 'Agents (1784)', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?variant=${variant}&theme=${theme}&language=${theme === 'dark' ? 'ru' : 'en'}`, ready: tickets });
    await tickets.click({ modifiers: ['Control'] });
    await expect(page.getByLabel('Copied', { exact: true })).toHaveText('1708');
    await expect(page.getByLabel('Location')).toHaveText('/fixture');
    await agents.press('Control+Enter');
    await expect(page.getByLabel('Copied', { exact: true })).toHaveText('1708,1784');
    await expect(page.getByLabel('Location')).toHaveText('/fixture');
    const handles = page.getByRole('button', { name: /^(Move table|Переместить таблицу)/ });
    await page.getByRole('button', { name: 'Before list' }).focus();
    await page.keyboard.press('Tab');
    await expect(handles.first()).toBeFocused();
    await expect(handles.first()).toHaveCSS('opacity', '1');
    await page.keyboard.press('Space');
    await expect(handles.first()).toHaveAttribute('aria-pressed', 'true');
    // KeyboardSensor attaches its document listener and measures rows after activation.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('1784');
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Order')).toHaveText('1784,1708');
    const firstHandle = handles.first();
    await firstHandle.focus();
    await page.keyboard.press('Space');
    await expect(firstHandle).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Order')).toHaveText('1784,1708');
    await expect(firstHandle).not.toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await firstHandle.hover();
    const start = await firstHandle.boundingBox();
    const target = await handles.last().boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 10, { steps: 3 });
    await expect(firstHandle).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('over droppable area 1708');
    await page.mouse.up();
    await expect(page.getByLabel('Order')).toHaveText('1708,1784');
    // PointerSensor keeps its click-capture guard for 50 ms after pointerup.
    await page.waitForTimeout(60);
    await agents.press('Enter');
    await expect(page.getByLabel('Location')).toHaveText('/tables/1784?mode=raw');
    await tickets.click();
    await expect(page.getByLabel('Location')).toHaveText('/tables/1708?mode=raw');
    await page.getByLabel('Clipboard failure').check();
    await tickets.click({ modifiers: ['Control'] });
    await expect(page.getByRole('status', { name: 'Notifications', exact: true })).toContainText('error:');
    await expect(page.getByLabel('Copied', { exact: true })).toHaveText('1708,1784');
    await page.getByLabel('Privileged', { exact: true }).uncheck();
    await page.getByLabel('Clipboard failure').uncheck();
    await agents.click({ modifiers: ['Control'] });
    await expect(page.getByLabel('Copied', { exact: true })).toHaveText('1708,1784');
    await agents.press('Enter');
    await expect(page.getByLabel('Location')).toHaveText('/tables/1784?mode=raw');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const audit = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    assert.deepEqual(audit.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await page.screenshot({ path: join(artifacts, `${variant}-${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(`${variant} ${width} ${theme}: copy, navigation, keyboard sorting, clipboard error, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
