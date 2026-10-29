import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'kanban-filter-'));
const entry = 'src/tests/kanban-filter-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const trigger = page.getByRole('button', { name: 'Статус', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: trigger });
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const state = async () => JSON.parse(await page.getByLabel('Состояние').textContent());
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Статус', exact: true });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    await dialog.getByRole('checkbox', { name: 'Новый' }).focus();
    await page.keyboard.press('Space');
    assert.deepEqual((await state()).selectFilters, { status: ['new'] });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Группировать' }).check();
    assert.equal((await state()).group, 'status');
    assert.equal((await state()).order, null);
    const statusViolations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-status-axe.json`), JSON.stringify(statusViolations, null, 2));
    assert.deepEqual(statusViolations.map(({ id }) => id), []);
    await dialog.getByRole('checkbox', { name: 'Группировать' }).uncheck();
    assert.equal((await state()).group, null);
    await dialog.getByRole('button', { name: 'Сброс', exact: true }).click();
    assert.deepEqual((await state()).selectFilters, {});
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Готово' }).focus();
    await page.keyboard.press('Tab');
    // Radix Popover loops Tab within the panel; Escape returns to the trigger.
    await expect(dialog.getByRole('button', { name: 'Убрать фильтр' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('checkbox', { name: 'Готово' })).toBeFocused();
    await page.getByRole('button', { name: 'Дата', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Дата', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await trigger.click();
    await page.getByRole('button', { name: 'Фоновое действие' }).click();
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await dialog.getByRole('checkbox', { name: 'Готово' }).check();
    await dialog.getByRole('button', { name: 'Убрать фильтр' }).click();
    assert.deepEqual((await state()).selectFilters, {});
    assert.deepEqual((await state()).activeFilterColumns, ['date', 'empty']);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const dateTrigger = page.getByRole('button', { name: 'Дата', exact: true });
    await dateTrigger.click();
    const dates = page.getByRole('dialog', { name: 'Дата', exact: true });
    await dates.getByLabel('От', { exact: true }).fill('2026-09-01');
    await dates.getByLabel('До', { exact: true }).fill('2026-09-30');
    assert.deepEqual((await state()).dateFilters, { date: { from: '2026-09-01', to: '2026-09-30' } });
    for (const label of ['Дата', 'Без опций']) {
      if (label === 'Без опций') {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('Нет опций');
      }
      const panel = page.getByRole('dialog', { name: label, exact: true });
      const violations = await page.evaluate(async () => (await window.axe.run('[role="dialog"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
      await writeFile(join(artifacts, `${width}-${theme}-${label}-axe.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations.map(({ id }) => id), []);
      const bounds = await panel.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'Panel must stay in viewport');
      await page.screenshot({ path: join(artifacts, `${width}-${theme}-${label}.png`) });
    }
    await page.keyboard.press('Escape');
    await dateTrigger.click();
    await dates.getByRole('button', { name: 'Сброс', exact: true }).click();
    assert.deepEqual((await state()).dateFilters, {});
    await dates.getByLabel('От', { exact: true }).fill('2026-10-01');
    await dates.getByRole('button', { name: 'Убрать фильтр' }).click();
    assert.deepEqual((await state()).dateFilters, {});
    assert.equal((await state()).submits, 0, 'Filter controls must not submit enclosing forms');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`${width} ${theme}: keyboard, focus, filters, dates, grouping, reset, removal, bounds, axe PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
