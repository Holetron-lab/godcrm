import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'chat-social-links-'));
const entry = 'src/tests/chat-social-links-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api')) return route.continue();
      errors.push(`Unexpected request: ${url.origin}${url.pathname}`);
      return route.abort();
    });
    let loads = 0;
    await page.route('https://www.youtube-nocookie.com/embed/**', route => {
      assert.equal(new URL(route.request().url()).searchParams.get('start'), '90');
      assert.ok(route.request().headers().referer);
      loads++;
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>YouTube fixture</title><body>Player fixture</body></html>' });
    });
    await page.goto(`${origin}/${entry}?theme=${theme}`);
    await expect(page.locator('iframe')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /YouTube/ })).toHaveCount(0);
    await expect(page.locator('[data-social-provider="Pinterest"]')).toHaveCount(4);
    await expect(page.locator('[data-social-provider="Instagram"]')).toHaveCount(2);
    for (const label of ['Обычный текст', 'Markdown']) {
      const section = page.getByRole('region', { name: label, exact: true });
      await expect(section.locator('iframe')).toHaveAttribute('title', 'YouTube');
    }
    await expect.poll(() => loads).toBe(2);
    await page.getByRole('button', { name: /Обновить сообщение/ }).click();
    await expect(page.locator('iframe')).toHaveCount(2);
    assert.equal(loads, 2, 'Parent refresh must preserve players');
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('main', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    assert.deepEqual(errors, [], 'Fixture browser/network errors');
    await page.close();
    process.stdout.write(`${width} ${theme}: cards, immediate embeds, stable frames, axe PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
