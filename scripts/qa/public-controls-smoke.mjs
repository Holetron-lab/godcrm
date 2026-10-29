import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'public-controls-'));
const entry = 'src/tests/public-controls-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    // Stop WebRTC before mounting the actual checker: no external STUN traffic.
    await page.addInitScript(() => { window.RTCPeerConnection = class { constructor() { throw new Error('Fixture: WebRTC blocked'); } }; });
    const ip = page.getByRole('button', { name: /IP Analysis/ });
    let scans = 0;
    const opening = openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: page.getByRole('heading', { level: 1 }) });
    // Register after openFixture's fail-closed route. These are local fixture responses only.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/v3/tools/palevo-check', route => { scans++; return route.fulfill({ json: {
      ip: '192.0.2.1', country: 'XX', country_name: 'Fixture', city: 'Test', isp: 'Test',
      modules: { ip: { score: 0, max: 10, findings: [{ key: 'ip', label: 'IP address', value: '192.0.2.1', severity: 'ok' }] } },
      total_score: 0, max_score: 10, percent: 0, verdict: { level: 'low', label: 'Test result', color: 'green', emoji: '✓' },
      recommendations: [
        { severity: 'info', module: 'ip', text: 'Review settings', steps: { title: 'Settings', why: 'Check privacy settings', steps: ['Open settings'] } },
        { severity: 'info', module: 'ip', text: 'No steps needed' },
      ],
    } }); });
    const fixture = await opening;
    await expect(ip).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(ip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('IP address', { exact: true })).toBeVisible();
    await page.getByText('IP address', { exact: true }).click();
    await expect(ip).toHaveAttribute('aria-expanded', 'true');
    await ip.focus();
    await page.keyboard.press('Space');
    await expect(ip).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Tab');
    const recommendation = page.getByRole('button', { name: /Review settings/ });
    await expect(recommendation).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Open settings', { exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(recommendation).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /No steps needed/ })).toHaveCount(0);
    const retry = page.getByRole('button', { name: /Проверить ещё раз/ });
    await page.keyboard.press('Tab');
    await expect(retry).toBeFocused();
    assert.notEqual(await retry.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.screenshot({ path: join(artifacts, `checker-${width}-${theme}.png`), fullPage: true });
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run({ include: [['button']] }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `checker-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const previousScans = scans;
    await retry.click();
    await expect.poll(() => scans).toBe(previousScans + 1);
    await expect(ip).toBeVisible();
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`checker ${width} ${theme}: keyboard, focus, noninteractive content, axe PASS\n`);
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const open = page.getByRole('button', { name: 'Open navigation' });
    const fixture = await openFixture({ server, page, entry: `${entry}?kind=sidebar&theme=${theme}`, ready: open });
    await page.keyboard.press('Tab');
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    const toggle = drawer.getByRole('button', { name: /^(Collapse|Expand) project Project$/ });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(drawer).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: join(artifacts, `sidebar-390-${theme}.png`), fullPage: true });
    await drawer.getByRole('link', { name: /Dashboard/ }).focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toHaveCount(0);
    await open.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Collapse project Project' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('link', { name: /Project/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await fixture.assertStable();
    await page.close();
    process.stdout.write(`sidebar 390 ${theme}: keyboard and pointer toggle/navigation PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
