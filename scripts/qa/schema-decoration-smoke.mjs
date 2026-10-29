import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'schema-decoration-'));
const entry = 'src/tests/schema-decoration-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
const accessibility = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const toggle = page.getByRole('button', { name: 'Toggle modules' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: toggle });
    const strips = page.getByTestId('table-widget-strips');
    const bounds = await strips.boundingBox();
    const label = await page.locator('svg text').boundingBox();
    assert.ok(label.y + label.height < bounds.y - 10, 'Project label has a gap above top strip');
    assert.equal(await page.getByTestId('table-widget-1').locator('.lucide-package-check').count(), 1);
    assert.equal(await page.getByTestId('table-widget-2').locator('.lucide-table-2').count(), 1);
    const nav = page.getByRole('region', { name: 'Navigation' });
    assert.equal(await nav.locator('.lucide-package-check').count(), 1);
    const positions = await nav.locator('[aria-expanded]:not([aria-haspopup])').evaluateAll(elements => elements.map(el => ({
      previousIsCheckbox: Boolean(el.previousElementSibling?.querySelector('.lucide-square, .lucide-square-check-big')),
    })));
    assert.ok(positions.length >= 2 && positions.every(p => p.previousIsCheckbox));
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(strips).toBeHidden();
    const hiddenLabel = await page.locator('svg text').boundingBox();
    assert.equal(Math.round(hiddenLabel.y - label.y), 42);
    await page.keyboard.press('Enter');
    await expect(strips).toBeVisible();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${theme}-axe.json`), JSON.stringify(violations, null, 2));
    accessibility.push({ theme, violations: violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) });
    await page.screenshot({ path: join(artifacts, `${theme}.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(`${theme}: geometry, icons, order, keyboard PASS\n`);
    await page.close();
  }
  assert.deepEqual(accessibility.filter(result => result.violations.length), [], 'Accessibility findings (see artifacts)');
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
