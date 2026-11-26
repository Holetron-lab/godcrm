import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

// ADR-207 W4.2 — "create on this table" links: the old create URL and the catalog's own `?tableId=` both
// end in an install plan that starts with that table connected. Keyboard only; axe on catalog and plan.
const copy = {
  en: { note: 'Opened from the table Deals. The install plan of a module will offer to connect it.', clear: 'Continue without the table',
    installKanban: 'Install Kanban', install: 'Install', back: 'Back to the catalog', tableFor: 'Table for Tasks',
    offered: 'The table Deals you came from is chosen for Tasks. Check below how its columns fit, or choose another table.',
    unavailable: 'The table #99 you came from cannot be connected: it was not found in this space. Choose another table below.' },
  ru: { note: 'Каталог открыт из таблицы «Deals». План установки модуля предложит её подключить.', clear: 'Продолжить без таблицы',
    installKanban: 'Установить «Kanban»', install: 'Установить', back: 'Назад в каталог', tableFor: 'Таблица для «Tasks»',
    offered: 'Таблица «Deals», из которой вы пришли, выбрана для «Tasks». Проверьте ниже, как подходят её колонки, или выберите другую таблицу.',
    unavailable: 'Таблицу «#99», из которой вы пришли, подключить нельзя: в этом спейсе её нет. Выберите другую таблицу ниже.' },
};
// The links as TableFilters / ToolbarButtons and RawTableViewPage write them, then the catalog's own URL.
const links = {
  toolbar: '/projects/5/widgets/create?tableId=7',
  rawView: '/projects/5/widgets/create?tableId=7&type=table',
  direct: '/projects/5/modules?tableId=7',
};
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'module-catalog-link-'));
const entry = 'src/tests/module-catalog-fixture/page.html';
const server = await createFixtureServer({ root, artifacts, entry });
const axeSource = await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let first = true;
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
    const text = copy[lang];
    const open = async (from) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const installKanban = page.getByRole('button', { name: text.installKanban, exact: true });
      const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&lang=${lang}&from=${encodeURIComponent(from)}`, ready: installKanban });
      await page.addScriptTag({ content: axeSource });
      return { page, fixture, installKanban };
    };
    const axe = async (page, state) => {
      const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations);
      await writeFile(join(artifacts, `${width}-${theme}-${lang}-${state}-axe.json`), JSON.stringify(violations, null, 2));
      // Known theme debt of the shared primary Button (white on #60a5fa in the dark theme), reported with W3.3.
      const themeDebt = (id, node) => theme === 'dark' && id === 'color-contrast'
        && node.any.some(({ data }) => data?.fgColor === '#ffffff' && data?.bgColor === '#60a5fa');
      const found = violations
        .map(({ id, nodes }) => ({ id, targets: nodes.filter(node => !themeDebt(id, node)).map(node => node.target) }))
        .filter(({ targets }) => targets.length > 0);
      assert.deepEqual(found, [], `axe: ${state}`);
      await page.screenshot({ path: join(artifacts, `${width}-${theme}-${lang}-${state}.png`), fullPage: true });
    };
    /** Tab forward until `locator` has focus; fails when it is not in the tab order. */
    const tabTo = async (page, locator) => {
      for (let step = 0; step < 80; step += 1) {
        if (await locator.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      assert.fail(`Not reachable with Tab: ${locator}`);
    };
    const location = page => page.getByLabel('Location');

    // Every combination walks the direct URL; the old links and the refused table need one pass.
    for (const source of first ? ['toolbar', 'rawView', 'direct'] : ['direct']) {
      const { page, fixture, installKanban } = await open(links[source]);
      await expect(page.getByText(text.note, { exact: true })).toBeVisible();
      await expect(location(page)).toHaveText(/^\/projects\/5\/modules\?tableId=7/);
      if (source === 'direct') {
        await axe(page, 'catalog');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
      }

      // The plan opens with the table connected and says so; the choice stays the user's.
      await tabTo(page, installKanban);
      await page.keyboard.press('Enter');
      await expect(page.getByText(text.offered, { exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: text.tableFor, exact: true })).toHaveValue('connect:7');
      await expect(page.getByRole('button', { name: text.install, exact: true })).toBeEnabled();
      await expect(location(page)).toHaveText(/tableId=7/);
      if (source === 'direct') {
        await axe(page, 'plan');

        // Back in the catalog the table is still there until the user lets it go.
        const back = page.getByRole('link', { name: text.back, exact: true });
        await back.focus();
        await page.keyboard.press('Enter');
        const clear = page.getByRole('link', { name: text.clear, exact: true });
        await tabTo(page, clear);
        await page.keyboard.press('Enter');
        await expect(page.getByText(text.note, { exact: true })).toHaveCount(0);
        await expect(location(page)).toHaveText('/projects/5/modules');
      }
      await fixture.assertStable();
      await page.close();
    }

    if (first) {
      // A table the space does not have: the dry-run refuses it, the screen says so and Install waits.
      const { page, fixture, installKanban } = await open('/projects/5/modules?tableId=99');
      await tabTo(page, installKanban);
      await page.keyboard.press('Enter');
      await expect(page.getByText(text.unavailable, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: text.install, exact: true })).toBeDisabled();
      await axe(page, 'refused');
      await fixture.assertStable();
      await page.close();
    }
    process.stdout.write(`${width} ${theme} ${lang}: ${first ? 'old links, refused table, ' : ''}direct URL, plan, clear, focus, axe PASS\n`);
    first = false;
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
