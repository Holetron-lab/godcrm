import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'step-groups-browser-'));
const entry = 'src/tests/step-groups-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: page.getByRole('heading') });
    await page.getByRole('button', { name: 'Шаги: 2' }).click();
    const tools = page.getByRole('button', { name: /инструмент/i });
    await expect(tools).toHaveCount(1);
    await tools.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить шаги');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Loaded result')).toBeVisible();
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Загрузить раннюю историю' }).click();
    await expect(page.getByText('Earlier history')).toBeVisible();
    await expect(page.getByText('Loaded result')).toBeVisible();
    await tools.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Loaded result')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Loaded result')).toBeVisible();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: merged tools, empty/retry, stable history, keyboard, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
