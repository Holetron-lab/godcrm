import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'kanban-assignee-'));
const entry = 'src/tests/kanban-assignee-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('dialog', dialog => dialog.accept());
    const field = page.getByRole('combobox', { name: 'Assignee', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: field });
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const audit = async (selector, name) => {
      const violations = await page.evaluate(async selector => (await window.axe.run(selector, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations, selector);
      await writeFile(join(artifacts, `${width}-${theme}-${name}-axe.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations.map(v => v.id), []);
    };
    await audit('main', 'mapping');
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-mapping.png`) });
    const custom = width === 390;
    await field.focus();
    await field.selectOption(custom ? 'team' : '__create_assignee__');
    if (!custom) {
      await page.getByLabel('Ошибка создания').check();
      await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
      await expect(field).toBeVisible();
      await page.getByLabel('Ошибка создания').uncheck();
    }
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await expect(page.getByLabel('Публичный режим')).toBeVisible();
    const state = async () => JSON.parse(await page.getByLabel('Состояние').textContent());
    const name = custom ? 'team' : 'assignee';
    assert.equal((await state()).config.kanban.assigneeColumn, name);
    assert.equal((await state()).creates, custom ? 0 : 1);
    await page.getByTitle('Назначить ответственного', { exact: true }).click();
    const add = page.getByTitle('Добавить', { exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Добавить ответственного' });
    await expect(dialog).toBeVisible();
    await audit('[role="dialog"]', 'picker');
    await dialog.getByRole('button', { name: 'Алиса', exact: true }).click();
    assert.deepEqual((await state()).data[name], ['7']);
    await add.click();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await add.click();
    await dialog.getByRole('button', { name: 'Боб', exact: true }).click();
    assert.deepEqual((await state()).data[name], ['7', '8']);
    await page.getByRole('button', { name: 'Убрать Алиса' }).click();
    assert.deepEqual((await state()).data[name], ['8']);
    await page.getByRole('button', { name: 'Завершить редактирование ответственных' }).click();
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-card.png`) });
    await page.getByLabel('Публичный режим').check();
    await expect(page.getByTitle('Редактировать', { exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`${width} ${theme}: mapping, create/retry, assignment, keyboard, public read-only, axe PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
