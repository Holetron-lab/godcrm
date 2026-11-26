import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

// ADR-207 W3.3 — InstallPlanTree with the keyboard alone: reach the conflict, follow it to the mapping
// row, resolve it, change a table binding, toggle seed and the menu entry, install. axe on both states.
const copy = {
  en: { install: 'Install', show: 'Show in the plan', priority: 'Target column for priority', table: 'Table for SLA rules',
    seed: 'Add sample rows to SLA rules', menu: 'Show Board in the menu', resolve: 'Resolve the conflicts to install.', collapse: 'Collapse all: Support' },
  ru: { install: 'Установить', show: 'Показать в плане', priority: 'Целевая колонка для priority', table: 'Таблица для «SLA rules»',
    seed: 'Добавить примеры строк в «SLA rules»', menu: 'Показывать «Board» в меню', resolve: 'Чтобы установить, снимите конфликты.', collapse: 'Свернуть все: Support' },
};
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'install-plan-'));
const entry = 'src/tests/install-plan-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
const axeSource = await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
    const text = copy[lang];
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const install = page.getByRole('button', { name: text.install, exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&lang=${lang}`, ready: install });
    const bindings = async () => JSON.parse(await page.getByLabel('Bindings').textContent());
    const axe = async (state) => {
      const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations);
      await writeFile(join(artifacts, `${width}-${theme}-${lang}-${state}-axe.json`), JSON.stringify(violations, null, 2));
      // Known theme debt, reported in the ticket and not this screen's to fix: the shared primary Button is
      // white on --color-primary-600, which the dark theme sets to #60a5fa. Nothing else is let through.
      const themeDebt = (id, node) => theme === 'dark' && id === 'color-contrast'
        && node.any.some(({ data }) => data?.fgColor === '#ffffff' && data?.bgColor === '#60a5fa');
      const found = violations
        .map(({ id, nodes }) => ({ id, targets: nodes.filter(node => !themeDebt(id, node)).map(node => node.target) }))
        .filter(({ targets }) => targets.length > 0);
      assert.deepEqual(found, [], `axe: ${state}`);
      await page.screenshot({ path: join(artifacts, `${width}-${theme}-${lang}-${state}.png`), fullPage: true });
    };
    /** Tab forward until `locator` has focus; fails when it is not in the tab order. */
    const tabTo = async (locator) => {
      for (let step = 0; step < 60; step += 1) {
        if (await locator.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      assert.fail(`Not reachable with Tab: ${locator}`);
    };
    await page.addScriptTag({ content: axeSource });

    // A blocking conflict keeps Install off and explains why.
    await expect(install).toBeDisabled();
    await expect(page.getByText(text.resolve, { exact: true })).toBeVisible();
    await axe('conflict');

    // The conflict leads to its mapping row even when the branch is closed.
    const collapse = page.getByRole('button', { name: text.collapse, exact: true });
    await tabTo(collapse);
    assert.notEqual(await collapse.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'Focus is visible');
    await page.keyboard.press('Enter');
    const priority = page.getByRole('combobox', { name: text.priority, exact: true });
    await expect(priority).toBeHidden();
    const show = page.getByRole('button', { name: text.show, exact: true });
    await tabTo(show);
    await page.keyboard.press('Enter');
    await expect(priority).toBeFocused();

    // prio → State → "+ new column": the conflict is gone once the server says so.
    await expect(priority).toHaveValue('prio');
    await priority.selectOption('__new');
    await expect(priority).toBeFocused();
    await expect(install).toBeEnabled();
    assert.deepEqual((await bindings()).tables.tickets, {
      action: 'connect', table_id: 1708, columns: [{ module_column: 'priority', target: '__new' }],
    });

    // Connecting moves the SLA node onto the existing table; focus stays on its select.
    const table = page.getByRole('combobox', { name: text.table, exact: true });
    await tabTo(table);
    await table.selectOption('connect:1783');
    await expect(table).toBeFocused();
    await table.selectOption('create');
    await expect(table).toBeFocused();

    const seed = page.getByRole('checkbox', { name: text.seed, exact: true });
    await tabTo(seed);
    await page.keyboard.press('Space');
    await expect(seed).not.toBeChecked();
    const menu = page.getByRole('checkbox', { name: text.menu, exact: true });
    await tabTo(menu);
    await page.keyboard.press('Space');
    await expect(menu).not.toBeChecked();
    assert.deepEqual(await bindings(), {
      tables: {
        tickets: { action: 'connect', table_id: 1708, columns: [{ module_column: 'priority', target: '__new' }] },
        sla: { action: 'create', seed: false },
      },
      sidebar: { board: false },
    });
    await axe('resolved');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');

    await tabTo(install);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Installed')).toHaveText('true');
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme} ${lang}: conflict → row, mapping, bindings, focus, install, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
