import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'access-list-'));
const entry = 'src/tests/access-list-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const access = page.getByRole('button', { name: 'Access', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: access });
    await expect(page.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
    await access.click();
    const list = page.getByRole('list', { name: 'Users' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    const avatar = list.getByRole('img', { name: 'Architect' });
    await expect(avatar).toBeVisible();
    assert.equal(await avatar.evaluate(img => img.complete && img.naturalWidth > 0), true);
    await expect(list.getByRole('listitem').first().locator('> div').first()).toHaveCSS('box-shadow', 'rgb(15, 118, 110) 3px 0px 0px 0px inset');
    const toggle = page.getByRole('button', { name: 'Access map: Architect' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Granular access for Architect')).toBeVisible();
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-expanded.png`), fullPage: true });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await page.getByRole('textbox', { name: 'Search by name, email or ID...' }).fill('missing');
    await expect(page.getByText('No matching users')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search by name, email or ID...' }).fill('');
    await toggle.click();
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const audit = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    await toggle.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await list.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}-list.png`), fullPage: true });
    await fixture.assertStable();
    process.stdout.write(`${width} ${theme}: list, avatar, stripe, keyboard accordion, search, axe PASS\n`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
