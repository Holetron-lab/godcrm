import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'terminal-controls-'));
const entry = 'src/tests/terminal-controls-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
async function tabTo(page, target) {
  for (let i = 0; i < 25; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail('Control unreachable with Tab');
}
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry, ready: page.getByRole('button', { name: 'Terminal 1', exact: true }) });
    const close = page.getByRole('button', { name: 'Close Terminal 2', exact: true });
    await close.waitFor();
    await tabTo(page, close);
    assert.equal(await close.evaluate(el => getComputedStyle(el).opacity), '1');
    await page.keyboard.press('Space');
    await close.waitFor({ state: 'hidden' });
    const calls = JSON.parse(await page.getByLabel('API calls').textContent());
    assert.equal(calls.filter(call => call === 'DELETE /terminal/sessions/2').length, 1);
    assert.ok(!calls.includes('GET /terminal/sessions/2'), 'Closing must not activate the session');
    const third = page.getByRole('button', { name: 'Terminal 3', exact: true });
    await tabTo(page, third);
    await page.keyboard.press('Enter');
    assert.equal(await third.getAttribute('aria-pressed'), 'true');
    const input = page.getByRole('textbox', { name: 'Terminal command' });
    await page.getByText('/fixture', { exact: true }).click();
    assert.ok(await input.evaluate(el => el === document.activeElement));
    await input.fill('  echo fixture  ');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('submitted').textContent.length > 0);
    assert.deepEqual(JSON.parse(await page.getByLabel('Submitted command').textContent()), { command: 'echo fixture', source: 'user' });
    await page.waitForFunction(() => !document.querySelector('input[type=text]').disabled);
    await tabTo(page, input);
    await page.keyboard.press('ArrowUp');
    assert.equal(await input.inputValue(), 'echo fixture');
    await page.keyboard.press('ArrowDown');
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('button button').count(), 0);
    await page.screenshot({ path: join(artifacts, `${width}-tabs.png`), fullPage: true });
    const opener = page.getByRole('button', { name: 'Open approval', exact: true });
    for (const [name, result, key] of [['Reject', 'reject', 'Enter'], ['Approve & Execute', 'approve', 'Space'], ['Always Allow', 'allow', 'Enter']]) {
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'Dangerous Command' });
      await dialog.waitFor();
      assert.ok(await dialog.getByRole('button', { name: 'Reject', exact: true }).evaluate(el => el === document.activeElement));
      assert.equal(await dialog.locator('code').textContent(), 'echo "<fixture>"');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
      }
      await tabTo(page, dialog.getByRole('button', { name, exact: true }));
      await page.keyboard.press(key);
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.getByLabel('Approval result').textContent(), result);
      await expect(opener).toBeFocused();
    }
    await opener.click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Approval result').textContent(), 'reject');
    await opener.click();
    await page.locator('div.fixed.inset-0[data-state="open"]').click({ position: { x: 2, y: 2 } });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Approval result').textContent(), 'reject');
    await page.getByRole('button', { name: 'Open busy approval' }).click();
    const busyDialog = page.getByRole('dialog', { name: 'Dangerous Command' });
    await busyDialog.waitFor();
    assert.equal(await busyDialog.getByRole('button').count(), 3);
    assert.equal(await busyDialog.locator('button:disabled').count(), 3);
    await page.keyboard.press('Escape');
    await page.locator('div.fixed.inset-0[data-state="open"]').click({ position: { x: 2, y: 2 } });
    assert.ok(await busyDialog.isVisible());
    assert.equal(await page.getByLabel('Approval result').textContent(), '');
    assert.equal(await busyDialog.getByRole('alert').textContent(), 'Fixture policy error');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-approval.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, keyboard: 'PASS', payload: 'PASS', approval: 'PASS', accessibility: 'PASS' }) + '\n');
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
