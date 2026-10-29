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
const artifacts = await mkdtemp(join(tmpdir(), 'remote-mcp-'));
const entry = 'src/tests/remote-mcp-fixture/index.html';
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) for (const language of ['en', 'ru']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const ru = language === 'ru';
    const ready = page.getByRole('button', { name: /Blender MCP/ });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&language=${language}`, ready });
    await page.addScriptTag({ content: axe });
    const audit = async state => {
      const result = await page.evaluate(async () => window.axe.run(document.querySelector('main'), {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      }));
      await writeFile(join(artifacts, `${width}-${theme}-${language}-${state}-axe.json`), JSON.stringify(result.violations, null, 2));
      assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `Accessibility: ${state}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    };
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await ready.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: ru ? 'Название' : 'Display name' })).toBeFocused();
    await page.keyboard.type('My Blender');
    await page.keyboard.press('Tab');
    await page.keyboard.type('https://example.com/mcp');
    await page.keyboard.press('Tab');
    await page.keyboard.type('fixture-secret');
    await audit('form');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${language}-form.png`), fullPage: true });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText(ru ? 'Сохранено · Не проверено' : 'Saved · Not checked')).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('fixture-secret');
    const check = page.getByRole('button', { name: ru ? 'Проверить связь' : 'Test connection' });
    await check.click();
    await expect(page.getByText(ru ? 'Включено · Проверка не прошла' : 'Enabled · Check failed')).toBeVisible();
    await check.click();
    await expect(page.getByText(ru ? 'Включено · Последняя проверка успешна' : 'Enabled · Last check passed')).toBeVisible();
    await page.getByRole('button', { name: ru ? 'Загрузить инструменты' : 'Discover tools' }).click();
    const tool = page.getByRole('checkbox', { name: 'scene_info' });
    await expect(tool).not.toBeChecked();
    await tool.focus();
    await page.keyboard.press('Space');
    await expect(tool).toBeChecked();
    await page.getByRole('button', { name: ru ? 'Сохранить разрешения' : 'Save tool permissions' }).click();
    await expect(page.getByText(ru ? 'Разрешения сохранены.' : 'Tool permissions saved.')).toBeVisible();
    await audit('tools');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${language}-tools.png`), fullPage: true });
    const toggle = page.getByRole('switch');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await expect(check).toBeDisabled();
    await expect(page.getByRole('button', { name: ru ? 'Загрузить инструменты' : 'Discover tools' })).toBeDisabled();
    await audit('disabled');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: ru ? 'Отозвать доступ' : 'Revoke', exact: true }).click();
    await expect(toggle).toHaveCount(0);
    await expect(check).toHaveCount(0);
    await audit('revoked');
    await fixture.assertStable();
    await page.close();
    process.stdout.write(JSON.stringify({ width, theme, language, keyboard: 'PASS', accessibility: 'PASS', smoke: 'PASS' }) + '\n');
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
