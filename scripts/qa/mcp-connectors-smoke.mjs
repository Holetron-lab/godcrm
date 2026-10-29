import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'mcp-connectors-'));
const entry = 'src/tests/mcp-connectors-fixture/index.html';
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) for (const language of ['en', 'ru']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const ready = page.getByRole('button', { name: /Blender MCP/ });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&language=${language}`, ready });
    await page.addScriptTag({ content: axe });
    const audit = async state => {
      const result = await page.evaluate(async () => window.axe.run(document.querySelector('main'), {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      }));
      await writeFile(join(artifacts, `${width}-${theme}-${language}-${state}-axe.json`), JSON.stringify(result.violations, null, 2));
      assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `Accessibility: ${state}`);
    };
    await ready.focus();
    await page.keyboard.press('Enter');
    await expect(ready).toHaveAttribute('aria-expanded', 'true');
    await audit('form');
    const name = page.getByRole('textbox', { name: language === 'ru' ? 'Название' : 'Display name' });
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await name.fill('My Blender');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const toggle = page.getByRole('switch', { name: language === 'ru' ? 'Включить My Blender' : 'Enable My Blender' });
    await expect(toggle).toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    const check = page.getByRole('button', { name: language === 'ru' ? 'Проверить связь' : 'Test connection' });
    await expect(check).toBeDisabled();
    assert.notEqual(await toggle.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(check).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('MCP timeout')).toBeVisible();
    await expect(toggle).toBeChecked();
    await audit('failed-check');
    await check.click();
    await expect(page.getByRole('status')).toContainText(language === 'ru' ? 'Связь установлена' : 'Connection successful');
    await expect(page.getByText('MCP timeout')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('125');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${language}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    await audit('success');
    await fixture.assertStable();
    await page.close();
    process.stdout.write(JSON.stringify({ width, theme, language, keyboard: 'PASS', accessibility: 'PASS', smoke: 'PASS' }) + '\n');
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
