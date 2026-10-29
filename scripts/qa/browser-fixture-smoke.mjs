import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'browser-fixture-'));
const entry = 'src/tests/browser-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const control = page.getByRole('switch', { name: 'Fixture switch', exact: true });
    const fixture = await openFixture({ server, page, entry, ready: control });
    await page.screenshot({ path: join(artifacts, `${width}.png`), fullPage: true });
    const style = await control.evaluate(element => {
      const css = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        spacing: css.getPropertyValue('--spacing-6').trim(),
        theme: css.getPropertyValue('--bg-primary').trim(),
        width: rect.width, height: rect.height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(style.spacing, 'Missing spacing tokens: load src/styles/index.css');
    assert.ok(style.theme, 'Missing theme tokens: load src/styles/index.css');
    assert.equal(style.height, 24, 'h-6 must resolve to 24px');
    assert.equal(style.width, 44, 'w-11 utility must be loaded');
    assert.equal(style.overflow, false);
    await page.keyboard.press('Tab');
    assert.ok(await control.evaluate(element => element === document.activeElement));
    await page.keyboard.press('Space');
    assert.equal(await control.getAttribute('aria-checked'), 'true');
    await control.click();
    assert.equal(await control.getAttribute('aria-checked'), 'false');
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ viewportWidth: width, ...style, keyboard: 'PASS', stable: true }) + '\n');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
