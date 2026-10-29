import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'mention-identity-'));
const entry = 'src/tests/mention-identity-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const pill = page.getByRole('button', { name: /@remote-helper/ });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: pill });
    await expect(pill).toContainText('🦊');
    await expect(pill).toHaveCSS('border-color', 'rgb(204, 85, 0)');
    await pill.hover();
    await expect(page.getByRole('tooltip')).toContainText('Space 11: Редактор');
    await expect(page.getByRole('tooltip')).toContainText('Неактивен');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const avatar = page.getByRole('button', { name: 'Remote Agent — Агент', exact: true });
    await avatar.focus();
    await expect(page.getByRole('tooltip')).toContainText('Space 11: Редактор');
    await expect(avatar).toHaveAttribute('aria-describedby', /radix/);
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const audit = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Human — Пользователь', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toContainText('Владелец-создатель');
    await page.getByRole('button', { name: 'Space 12', exact: true }).click();
    await avatar.hover();
    await expect(page.getByRole('tooltip')).toContainText('Space 12: Не добавлен в спейс');
    await page.getByRole('button', { name: 'Space 13', exact: true }).click();
    await avatar.hover();
    await expect(page.getByRole('tooltip')).toContainText('Не удалось загрузить уровень');
    await expect(page.getByRole('tooltip')).not.toContainText('Не добавлен');
    await page.keyboard.press('Escape');
    const command = page.getByRole('button', { name: '/remote-helper', exact: true });
    await command.focus();
    await command.press('Enter');
    await command.press('Space');
    await expect(page.getByLabel('Commands')).toHaveText('2');
    await expect(page.getByLabel('Submissions')).toHaveText('0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: identity, hover, focus, Escape, space roles, failure, keyboard, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
