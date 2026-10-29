import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'week-picker-'));
const entry = 'src/tests/week-picker-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const lang of ['en', 'ru']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
    const opener = page.getByRole('button', { name: 'Open week picker' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&lang=${lang}`, ready: opener });
    const week = n => page.getByRole('button', { name: `${lang === 'ru' ? 'Неделя' : 'Week'} ${n}, 2026`, exact: true });
    await opener.click();
    await page.keyboard.press('Tab'); // Previous month
    await page.keyboard.press('Tab'); // Next month
    await page.keyboard.press('Tab'); // First week, including December 2025 dates
    await expect(week(1)).toBeFocused();
    await expect(week(1)).toHaveAttribute('aria-pressed', 'true');
    assert.notEqual(await week(1).evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-${lang}.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Events')).toHaveText('commit:2026-W01');
    await opener.click();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await expect(week(2)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Selected week')).toHaveText('2026-W02');
    await expect(page.getByLabel('Events')).toHaveText('commit:2026-W01,commit:2026-W02');
    await opener.click();
    await expect(week(2)).toHaveAttribute('aria-pressed', 'true');
    await week(3).click();
    await expect(page.getByLabel('Selected week')).toHaveText('2026-W03');
    await opener.click();
    await page.getByRole('button', { name: lang === 'ru' ? 'Предыдущий месяц' : 'Previous month', exact: true }).click();
    await week(1).click(); // December grid ends in ISO week 1 of 2026.
    await expect(page.getByLabel('Selected week')).toHaveText('2026-W01');
    await opener.click();
    await page.getByRole('button', { name: lang === 'ru' ? 'Следующий месяц' : 'Next month', exact: true }).click();
    await expect(page.getByText(lang === 'ru' ? 'Февраль 2026' : 'February 2026', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(week(1)).toHaveCount(0);
    await expect(page.getByLabel('Selected week')).toHaveText('2026-W01');
    await expect(page.getByLabel('Events')).toHaveText('commit:2026-W01,commit:2026-W02,commit:2026-W03,commit:2026-W01,cancel');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme} ${lang}: keyboard, pointer, ISO boundary, cancellation, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
