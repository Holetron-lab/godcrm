import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'lint-dialogs-'));
const entry = 'src/tests/lint-dialogs-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [kind, openerName] of [['manager', 'Create Key'], ['project', 'New Key'], ['row', 'Open row']]) {
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const opener = page.getByRole('button', { name: openerName, exact: true });
      const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready: opener, timeout: 60_000 });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      const controls = dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled])');
      await controls.first().focus();
      await page.keyboard.press('Shift+Tab');
      await expect(controls.last()).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(controls.first()).toBeFocused();
      await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
      await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations.map(({ id }) => id), []);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      await dialog.click({ position: { x: 5, y: 5 } });
      await expect(dialog).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await opener.click();
      await dialog.getByRole('button', { name: kind === 'row' ? 'Close' : 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await fixture.assertStable();
      process.stdout.write(JSON.stringify({ kind, width, theme, keyboard: 'PASS', axe: 'PASS' }) + '\n');
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
