import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'widget-table-23198-'));
const entry = 'src/tests/widget-table-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const fixture = await openFixture({ server, page, entry, ready: page.getByText('Бета', { exact: true }) });
    await expect(page.getByRole('link', { name: 'Перейти на страницу таблицы' })).toHaveAttribute('href','/tables/123?mode=raw');
    assert.equal(await page.locator('tbody img').first().evaluate(img => img.getBoundingClientRect().height), 140);
    await page.getByRole('button', { name:'Сортировка: Название', exact:true }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Альфа');
    await page.getByRole('button', { name:'Сортировка: Название', exact:true }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Бета');
    await page.getByRole('button', { name:'Сортировка: Название', exact:true }).click();
    await page.getByRole('button', { name:'Меню колонки: Название', exact:true }).click();
    await page.getByRole('menuitem', { name:'Скрыть в виджете' }).click();
    await expect(page.getByText('Бета', { exact:true })).toHaveCount(0);
    await page.getByRole('button', { name:'Видимость колонок в виджете', exact:true }).click();
    await page.getByRole('checkbox', { name:'Название', exact:true }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name:'Меню колонки: Название', exact:true }).click();
    await page.getByRole('menuitem', { name:'Активная колонка' }).click();
    await page.getByRole('cell', { name:'Редактировать: Название', exact:true }).first().press('Enter');
    await page.getByRole('textbox', {name:'Название', exact:true}).fill('Обновлено');
    await page.getByRole('button', {name:'Сохранить', exact:true}).click();
    await expect(page.getByText('Обновлено', {exact:true})).toBeVisible();
    await expect(page.getByRole('cell', { name:'Редактировать: Название', exact:true }).first()).toBeFocused();
    await page.getByRole('button', { name:'Меню колонки: Статус', exact:true }).click();
    await page.getByRole('menuitem', { name:'Активная колонка' }).click();
    await page.getByRole('cell', { name:'Редактировать: Статус', exact:true }).first().click();
    await page.getByRole('combobox', {name:'Статус', exact:true}).selectOption('done');
    await page.getByRole('button', {name:'Сохранить', exact:true}).click();
    await expect(page.locator('tbody tr').first()).toContainText('Готово');
    await page.addScriptTag({content:await readFile(join(root,'node_modules/axe-core/axe.min.js'),'utf8')});
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
    if (violations.length) console.log(JSON.stringify(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))})),null,2));
    assert.deepEqual(violations.map(v=>v.id), []);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path:join(artifacts, `${width}.png`),fullPage:true});
    await fixture.assertStable();
    await page.close();
    console.log(`${width}: sorting, visibility, keyboard edit, status, image height, link, axe PASS`);
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
