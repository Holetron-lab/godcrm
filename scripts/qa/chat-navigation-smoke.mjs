import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'chat-navigation-'));
const entry = 'src/tests/chat-navigation-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry, ready: page.getByText('Frontend', { exact: true }) });
    const draft = page.getByRole('textbox', { name: 'Chat draft' });
    await draft.fill('Keep my draft');
    await page.getByRole('button', { name: 'Add agent event' }).click();
    await page.locator('[data-chat-info-bar]').getByText('Architect', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Открыть журнал' }).click();
    await page.getByText('Journal loaded').waitFor();
    assert.equal(await page.getByLabel('Current route').textContent(), '/tables/42?action=new');
    assert.equal(await draft.inputValue(), 'Keep my draft');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('link', { name: 'Открыть журнал' }).waitFor();
    await page.getByRole('button', { name: 'Bind row', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    for (let n = 0; n < 5; n++) {
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    }
    await page.screenshot({ path: join(artifacts, `${width}-dialog.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await draft.inputValue(), 'Keep my draft');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-participants.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, participants: 'PASS', navigation: 'PASS', dialog: 'PASS', stable: true }) + '\n');
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
