import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'passport-authority-browser-'));
const entry = 'src/tests/passport-authority-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const issue = page.getByRole('button', { name: 'Выдать паспорт', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: issue });
    const settings = page.getByRole('region', { name: 'Настройки' });
    const roster = page.getByRole('region', { name: 'Ростер' });
    await page.getByLabel('Основная инструкция').fill('Unsaved draft');
    await issue.focus();
    await page.keyboard.press('Enter');
    await expect(settings.getByRole('button', { name: 'Паспорт выдан' })).toBeDisabled();
    await expect(page.getByLabel('Основная инструкция')).toHaveValue('Unsaved draft');
    await roster.getByRole('button', { name: 'Действия: Reviewer' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Отозвать паспорт' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'deny', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('нужны права администратора');
    await expect(roster.getByRole('status')).toContainText('нужны права администратора');
    await expect(roster.getByRole('button', { name: 'Действия: Reviewer' })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: /паспорт/i })).toHaveCount(0);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'error', exact: true }).click();
    await expect(settings.getByRole('alert')).toContainText('Не удалось проверить права');
    await expect(roster.getByRole('alert')).toContainText('Не удалось проверить права');
    await page.getByRole('button', { name: 'allow', exact: true }).click();
    await expect(roster.getByRole('button', { name: 'Действия: Reviewer' })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: authority, issue, draft, keyboard, denied, retry, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
