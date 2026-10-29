import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'mail-accessibility-'));
const entry = 'src/tests/mail-accessibility-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    for (const kind of ['composer', 'page', 'picker', 'reply']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const ready = kind === 'composer' ? page.getByRole('slider', { name: 'Изменить высоту' })
        : kind === 'picker' ? page.getByRole('button', { name: 'Привязать письмо' })
        : kind === 'reply' ? page.getByRole('textbox', { name: 'Кому', exact: true }) : page.locator('main');
      const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready, timeout: 60_000 });
      let axeScope;
      if (kind === 'composer' || (kind === 'page' && width >= 768)) {
        const handle = page.getByRole('slider');
        const initial = kind === 'composer' ? 180 : 288;
        const increment = kind === 'composer' ? 'ArrowUp' : 'ArrowRight';
        await handle.focus();
        await page.keyboard.press(increment);
        await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 20));
        const outline = await handle.evaluate(el => getComputedStyle(el).outlineStyle);
        assert.notEqual(outline, 'none');
        await page.keyboard.press('Home');
        await expect(handle).toHaveAttribute('aria-valuenow', kind === 'composer' ? '120' : '220');
        await page.keyboard.press('End');
        await expect(handle).toHaveAttribute('aria-valuenow', kind === 'composer' ? '630' : '560');
        await page.keyboard.press('Home');
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + (kind === 'page' ? 40 : 0), box.y + box.height / 2 - (kind === 'composer' ? 40 : 0));
        await page.mouse.up();
        assert.ok(Number(await handle.getAttribute('aria-valuenow')) > (kind === 'composer' ? 120 : 220));
        axeScope = '[role="slider"]';
      }
      if (kind === 'composer') {
        const input = page.getByRole('textbox', { name: 'Кому', exact: true });
        await input.fill('next@example.test');
        await page.getByRole('button', { name: 'first@example.test', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(input).toBeFocused();
        await expect(input).toHaveValue('first@example.test');
        await expect(page.getByRole('button', { name: 'next@example.test', exact: true })).toBeVisible();
        await page.keyboard.press('Enter');
        await page.locator('.ql-editor').click();
        await page.keyboard.press('Control+Enter');
        await expect(page.getByLabel('Отправлено')).toHaveText('1');
      }
      if (kind === 'page' && width < 768) {
        await page.screenshot({ path: join(artifacts, `mobile-before-${theme}.png`), fullPage: true });
        await expect(page.getByRole('slider')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Папки', exact: true })).toBeHidden();
        const search = await page.getByRole('textbox', { name: 'Поиск по почте' }).boundingBox();
        assert.ok(search.width >= 180, 'Mobile search must remain usable without horizontal scrolling');
        await page.getByRole('button', { name: 'Развернуть папки' }).click();
        await expect(page.getByRole('button', { name: 'Входящие', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Свернуть папки' }).click();
        await page.getByRole('button', { name: 'Test', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Test', exact: true })).toBeVisible();
        const pane = await page.locator('aside').boundingBox();
        assert.ok(pane.width >= width - 20, 'Mobile reader should use the full content width');
        await page.screenshot({ path: join(artifacts, `reader-${width}-${theme}.png`), fullPage: true });
        await page.locator('aside .ql-editor').scrollIntoViewIfNeeded();
        await expect(page.locator('aside .ql-editor')).toBeInViewport();
        await page.getByRole('button', { name: 'Назад к списку' }).click();
        await page.getByRole('button', { name: 'Написать письмо' }).click();
        const to = page.getByRole('textbox', { name: 'Кому', exact: true });
        await to.fill('draft@example.test');
        await page.locator('.ql-editor').fill('Draft survives rotation');
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(page.locator('.ql-editor')).toHaveText('Draft survives rotation');
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole('button', { name: 'draft@example.test', exact: true })).toBeVisible();
        await expect(page.locator('.ql-editor')).toHaveText('Draft survives rotation');
        await page.screenshot({ path: join(artifacts, `compose-${width}-${theme}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await page.getByRole('button', { name: 'Настройки почты', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Настройки почты' })).toBeVisible();
        await page.getByRole('button', { name: 'Закрыть настройки' }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      if (kind === 'picker') {
        await ready.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('textbox', { name: 'Поиск записи для привязки' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(ready).toBeFocused();
      }
      if (kind === 'reply') {
        await page.locator('.ql-editor').fill('Template body');
        await page.getByRole('button', { name: 'Другие действия' }).click();
        await page.getByRole('menuitem', { name: 'Сохранить как шаблон…' }).click();
        await expect(page.getByRole('textbox', { name: 'Название шаблона' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('.ql-editor')).toHaveText('Template body');
      }
      if (axeScope) {
        await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
        const violations = await page.evaluate(async scope => (await window.axe.run(scope, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })).violations, axeScope);
        await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
        assert.deepEqual(violations.map(({ id }) => id), []);
      }
      await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
      await fixture.assertStable();
      process.stdout.write(JSON.stringify({ kind, width, theme, status: 'PASS' }) + '\n');
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
