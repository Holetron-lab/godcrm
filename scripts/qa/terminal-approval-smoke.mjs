// Approval dialog must close and stay closed after one real click / Escape,
// with TerminalPanel mounted once and twice (as AIChatPanel does).
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'terminal-approval-'));
const entry = 'src/tests/terminal-approval-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
const decisions = calls => calls.filter(c => /\/commands\/10\/(approve|reject)$/.test(c));
async function settle(page, ms = 1500) {
  await page.waitForTimeout(ms);
  return page.locator('[role=dialog]').count();
}
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const panels of [1, 2]) {
    for (const action of ['click', 'escape']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      // CSS locator: with two mounted modal dialogs Radix aria-hides both, so role queries see none.
      const dialog = page.locator('[role=dialog]');
      await openFixture({ server, page, entry: `${entry}?panels=${panels}`, ready: dialog.last() });
      await page.waitForTimeout(500); // let the second panel's polls land
      // Each mounted panel owns a dialog; CSS locator sees the aria-hidden lower one too.
      assert.equal(await page.locator('[role=dialog]').count(), panels);
      if (action === 'click') {
        // Real pointer click at the visible button's centre — what the user does.
        const box = await dialog.last().locator('button', { hasText: 'Approve & Execute' }).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await page.keyboard.press('Escape');
      }
      const expected = action === 'click' ? 'approve' : 'reject';
      const open = await settle(page);
      const calls = JSON.parse(await page.getByLabel('API calls').textContent());
      await page.screenshot({ path: join(artifacts, `${panels}-${action}.png`), fullPage: true });
      const result = { panels, action, decisions: decisions(calls), dialogsOpen: open };
      process.stdout.write(JSON.stringify(result) + '\n');
      assert.deepEqual(result.decisions, [`POST /terminal/commands/10/${expected}`], 'exactly one decision request');
      assert.equal(open, 0, 'dialog must be closed after the decision');
      assert.equal(await settle(page, 4000), 0, 'dialog must stay closed across polls');
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
