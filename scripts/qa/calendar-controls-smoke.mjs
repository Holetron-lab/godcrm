import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'calendar-controls-'));
const entry = 'src/tests/calendar-controls-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const event = page.getByRole('button', { name: 'Встреча 1', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: event, timeout: 60_000 });
    const state = async () => JSON.parse(await page.getByLabel('Состояние').textContent());
    const date = (await state()).date;
    const day = page.getByRole('button', { name: `Добавить событие: ${date}`, exact: true });
    await day.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    assert.deepEqual((await state()).created, [date, date]);
    await event.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    assert.equal((await state()).opened, 2);
    assert.equal((await state()).created.length, 2);
    const more = page.getByRole('button', { name: /ещё/ });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Встреча 4', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Свернуть события' }).click();
    await expect(page.getByRole('button', { name: 'Встреча 4', exact: true })).toHaveCount(0);
    // The transparent date button must still receive clicks in empty cell space.
    await day.click({ position: { x: 3, y: 3 } });
    assert.equal((await state()).created.length, 3);
    await event.click();
    assert.equal((await state()).opened, 3);
    const target = page.getByRole('button', { name: /Добавить событие: / }).first();
    const bounds = await target.boundingBox();
    await event.dragTo(target, { targetPosition: { x: bounds.width / 2, y: bounds.height - 4 } });
    assert.equal((await state()).moved, 1);
    assert.equal((await state()).created.length, 3);
    assert.equal((await state()).submits, 0);
    const heading = page.getByRole('heading', { level: 2 });
    const month = await heading.textContent();
    await page.getByRole('button', { name: 'Следующий месяц' }).click();
    await expect(heading).not.toHaveText(month);
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(heading).toHaveText(month);
    await day.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(day).toBeFocused();
    assert.equal(await day.evaluate(element => element.matches(':focus-visible')), true);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('main', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(JSON.stringify({ width, theme, keyboard: 'PASS', pointer: 'PASS', drag: 'PASS', axe: 'PASS' }) + '\n');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
