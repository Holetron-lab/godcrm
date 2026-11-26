import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

// ADR-207 W4.2 — the module catalog with the keyboard alone: every filter, the administrator gate on a
// card, the empty result and Install. axe on the full grid and on the empty state.
const copy = {
  en: { search: 'Search modules', all: 'All', builtIn: 'Built-in', agents: 'Agents', category: 'Category', mine: 'I can install myself',
    installKanban: 'Install Kanban', installAgents: 'Install AI Agents', admin: 'Administrator required', noMatch: 'No modules match these filters.', reset: 'Clear filters' },
  ru: { search: 'Поиск модулей', all: 'Все', builtIn: 'Встроенные', agents: 'Агенты', category: 'Категория', mine: 'Могу установить сам',
    installKanban: 'Установить «Kanban»', installAgents: 'Установить «AI Agents»', admin: 'Требуется администратор', noMatch: 'Под эти фильтры ничего не подошло.', reset: 'Сбросить фильтры' },
};
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'module-catalog-'));
const entry = 'src/tests/module-catalog-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
const axeSource = await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
    const text = copy[lang];
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const installKanban = page.getByRole('button', { name: text.installKanban, exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&lang=${lang}`, ready: installKanban });
    const filters = async () => JSON.parse(await page.getByLabel('Filters').textContent());
    const axe = async (state) => {
      const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations);
      await writeFile(join(artifacts, `${width}-${theme}-${lang}-${state}-axe.json`), JSON.stringify(violations, null, 2));
      // Known theme debt of the shared primary Button (white on --color-primary-600 = #60a5fa in the dark
      // theme), reported with W3.3 and not this screen's to fix. Nothing else is let through.
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

    // A module that needs an administrator stays in the grid, says so and cannot be installed.
    await expect(page.getByRole('article')).toHaveCount(4);
    await expect(page.getByRole('button', { name: text.installAgents, exact: true })).toBeDisabled();
    await expect(page.getByRole('article', { name: 'AI Agents' }).getByText(text.admin, { exact: true })).toBeVisible();
    await axe('grid');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');

    // Origin is one radio group: Tab enters it, arrows move, the focused chip shows a ring.
    const all = page.getByRole('radio', { name: text.all, exact: true });
    await tabTo(all);
    assert.notEqual(await all.evaluate(element => getComputedStyle(element.nextElementSibling).boxShadow), 'none', 'Focus is visible on a chip');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: text.builtIn, exact: true })).toBeChecked();
    await expect(page.getByRole('article')).toHaveCount(2);

    // Components, category and "I can install myself" narrow the same result.
    const agents = page.getByRole('checkbox', { name: text.agents, exact: true });
    await tabTo(agents);
    await page.keyboard.press('Space');
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.keyboard.press('Space');
    const category = page.getByRole('combobox', { name: text.category, exact: true });
    await tabTo(category);
    await category.selectOption('general');
    await expect(category).toBeFocused();
    const mine = page.getByRole('checkbox', { name: text.mine, exact: true });
    await tabTo(mine);
    await page.keyboard.press('Space');
    assert.deepEqual(await filters(), { components: [], canInstall: true, search: '', origin: 'default', category: 'general' });
    await expect(page.getByRole('article')).toHaveCount(1);

    // Install from the keyboard.
    await tabTo(installKanban);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Installed')).toHaveText('preset_kanban_board');

    // Nothing found: the reason and one way out.
    const search = page.getByRole('searchbox', { name: text.search, exact: true });
    await search.fill('zzz');
    await expect(page.getByText(text.noMatch, { exact: true })).toBeVisible();
    await axe('empty');
    const reset = page.getByRole('button', { name: text.reset, exact: true });
    await tabTo(reset);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('article')).toHaveCount(4);
    assert.deepEqual(await filters(), { components: [], canInstall: false, search: '' });

    await fixture.assertStable();
    process.stdout.write(`${width} ${theme} ${lang}: filters, admin gate, install, empty state, focus, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
