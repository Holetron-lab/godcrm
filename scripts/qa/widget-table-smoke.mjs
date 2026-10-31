import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'widget-table-23210-'));
const entry = 'src/tests/widget-table-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
    await page.addInitScript(theme => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = theme; }); }, theme);
    const fixture = await openFixture({ server, page, entry, ready: page.getByText('Бета', { exact: true }).first() });
    const tableLink = page.getByRole('link', { name: 'Open table' });
    await expect(tableLink).toHaveAttribute('href','/tables/123');
    await expect(tableLink.locator('.lucide-table-2')).toHaveCount(1);
    await expect(page.locator('thead th').first()).toHaveCSS('padding', '4px 12px');
    assert.equal(await page.locator('tbody img').first().evaluate(img => img.getBoundingClientRect().height), 140);
    await expect(page.getByRole('button', { name: /Sort:|Column menu:/ })).toHaveCount(0);
    const surface = await page.locator('table').evaluate(table => {
      const body = table.querySelector('tbody');
      const row = body.lastElementChild;
      return {
        freeHeight: table.parentElement.clientHeight - table.getBoundingClientRect().height,
        background: getComputedStyle(table.parentElement).backgroundColor,
        bodyBackground: getComputedStyle(body).backgroundColor,
        border: getComputedStyle(row).borderBottomWidth,
      };
    });
    assert.ok(surface.freeHeight > 50, 'Fixture leaves visible space below the table');
    assert.notEqual(surface.background, surface.bodyBackground, 'Unused space has a distinct theme surface');
    assert.equal(surface.border, '1px', 'The last row retains its lower separator');
    await page.getByRole('button', { name:'Редактировать виджет', exact:true }).click();
    await page.getByRole('button', { name:'Show 1 hidden columns', exact:true }).click();
    await expect(page.getByRole('button', { name:'Column menu: Название', exact:true }).locator('.lucide-ellipsis-vertical')).toHaveCount(1);
    await page.screenshot({path:join(artifacts, `${width}-${theme}-edit.png`),fullPage:true});
    await page.getByRole('button', { name:'Sort: Название', exact:true }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Альфа');
    await page.getByRole('button', { name:'Sort: Название', exact:true }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Бета');
    await page.getByRole('button', { name:'Sort: Название', exact:true }).click();
    await page.getByRole('button', { name:'Column menu: Название', exact:true }).click();
    await page.getByRole('menuitem', { name:'Hide in widget' }).click();
    await page.getByRole('button', { name:'Hide columns', exact:true }).click();
    await expect(page.getByText('Бета', { exact:true })).toHaveCount(1);
    await page.getByRole('button', { name:'Widget column visibility', exact:true }).click();
    await page.getByRole('checkbox', { name:'Название', exact:true }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name:'Show 1 hidden columns', exact:true }).click();
    await page.getByRole('button', { name:'Column menu: Название', exact:true }).click();
    await page.getByRole('menuitem', { name:'Active column' }).click();
    await page.getByRole('cell', { name:'Edit: Название', exact:true }).first().press('Enter');
    await page.getByRole('textbox', {name:'Название', exact:true}).fill('Обновлено');
    await page.getByRole('textbox', {name:'Название', exact:true}).press('Shift+Enter');
    await expect(page.getByText('Обновлено', {exact:true})).toHaveCount(2);
    await expect(page.getByRole('cell', { name:'Edit: Название', exact:true }).first()).toBeFocused();
    await page.getByRole('button', { name:'Column menu: Статус', exact:true }).click();
    await page.getByRole('menuitem', { name:'Active column' }).click();
    await page.getByRole('cell', { name:'Edit: Статус', exact:true }).first().click();
    await page.getByRole('textbox', {name:'Поиск опций', exact:true}).waitFor();
    await page.getByRole('button', {name:'Готово', exact:true}).click();
    await expect(page.locator('tbody tr').first()).toContainText('Готово');
    await page.locator('[data-rollup-source="name"]').filter({hasText:'Обновлено'}).dblclick();
    await page.getByRole('textbox', {name:'Название', exact:true}).fill('Роллап');
    await page.getByRole('textbox', {name:'Название', exact:true}).press('Shift+Enter');
    await expect(page.locator('[data-rollup-source="name"]').first()).toContainText('Роллап');
    await page.locator('[data-rollup-source="status"]').filter({hasText:'done'}).first().dblclick();
    await page.getByRole('textbox', {name:'Поиск опций', exact:true}).waitFor();
    await page.getByRole('button', {name:'Новая', exact:true}).click();
    await expect(page.locator('[data-rollup-source="status"]').first()).toContainText('new');
    await page.addScriptTag({content:await readFile(join(root,'node_modules/axe-core/axe.min.js'),'utf8')});
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
    if (violations.length) console.log(JSON.stringify(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))})),null,2));
    assert.deepEqual(violations.map(v=>v.id), []);
    await page.getByRole('button', { name:'Редактировать виджет', exact:true }).click();
    await expect(page.getByRole('button', { name: /Sort:|Column menu:/ })).toHaveCount(0);
    await expect(page.getByRole('cell', { name:'Edit: Название', exact:true }).first()).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path:join(artifacts, `${width}-${theme}.png`),fullPage:true});
    // Scroll the image underneath the sticky header and check actual paint order.
    await page.setViewportSize({ width, height: 300 });
    await page.locator('table').evaluate(table => {
      table.parentElement.scrollLeft = table.querySelector('tbody img').closest('td').offsetLeft;
      table.parentElement.scrollTop = 100;
    });
    await expect.poll(() => page.locator('thead').evaluate(head => {
      const image = head.closest('table').querySelector('tbody img').getBoundingClientRect();
      const header = head.getBoundingClientRect();
      const viewport = head.closest('table').parentElement.getBoundingClientRect();
      const x = Math.max(viewport.left + 2, image.left + 10);
      const y = header.top + header.height / 2;
      return image.top < header.bottom && image.bottom > y && !!document.elementFromPoint(x, y)?.closest('thead');
    })).toBe(true);
    await fixture.assertStable();
    await page.close();
    console.log(`${width} ${theme}: edit mode, sorting, visibility, keyboard edit, image/header layering, last-row border, spare surface, axe PASS`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
