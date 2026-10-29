import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer } from './browser-fixture.mjs';

// Real document composition; all API responses are hermetic, with a held refetch.
const artifacts = await mkdtemp(join(tmpdir(), 'document-async-save-'));
const entry = 'src/tests/document-async-save-fixture/index.html';
const server = await createFixtureServer({ root: process.cwd(), artifacts, entry });
const origin = new URL(server.resolvedUrls.local[0]).origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const action of ['keyboard', 'blur']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const writes = [];
    let row = { id: 7, level: 'text', order: 10, content_en: '' };
    let heldRefetch;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.addInitScript(() => { localStorage.setItem('god-crm-language', 'ru'); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname + url.search;
      const reply = data => route.fulfill({ json: data });
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      if (url.origin === origin) {
        if (path === '/api/v3/access/project/1/my-level') return reply({ data: { access_level: 'owner' } });
        if (path === '/api/v3/tables/41/columns') return reply({ data: [] });
        if (path === '/api/v3/tables/42/rows?limit=10') return reply({ data: { rows: [{ id: row.id, data: row }] } });
        if (path === '/api/v3/tables/41/rows?limit=5000') return reply({ data: { rows: [
          { id: 1, data: { name: 'Async save', slug: 'async-save', table_id: 42 } },
        ] } });
        if (path === '/api/v3/tables/42/rows/7' && route.request().method() === 'PUT') {
          const { data } = route.request().postDataJSON();
          writes.push(data);
          row = { ...row, ...data };
          return reply({ success: true });
        }
        if (path === '/api/v3/documents/1/content?registry_table_id=41') {
          if (writes.length && !heldRefetch) { heldRefetch = route; return; }
          return reply({ data: { table_id: 42, items: [row] } });
        }
      }
      errors.push(`Unexpected request: ${url.origin}${path}`);
      return route.abort();
    });
    await page.goto(`${origin}/${entry}`);
    const trigger = page.getByRole('button', { name: 'Нажмите чтобы редактировать...' });
    await expect(trigger).toBeVisible();
    await server.waitForRequestsIdle();
    // Prepare Vite dependencies before interactions; no reload/retry on failure.
    await page.reload();
    await expect(trigger).toBeVisible();
    await server.waitForRequestsIdle();
    await expect(page.getByRole('combobox', { name: 'Язык документа' })).toHaveValue('en');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('textbox', { name: 'Текст блока (Markdown)' });
    await expect(editor).toBeFocused();
    await editor.fill('English persisted');
    const outside = page.getByRole('button', { name: 'После документа' });
    if (action === 'keyboard') await page.keyboard.press('Control+Enter');
    else await outside.click();
    await expect.poll(() => Boolean(heldRefetch)).toBe(true);
    await expect(editor).toHaveCount(0);
    await expect(action === 'keyboard' ? trigger : outside).toBeFocused();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].content_en, 'English persisted');
    assert.equal('content_ru' in writes[0] || 'content' in writes[0], false);
    await heldRefetch.fulfill({ json: { data: { table_id: 42, items: [row] } } });
    await expect(page.getByText('English persisted', { exact: true })).toBeVisible();
    await expect(action === 'keyboard' ? page.getByRole('button', { name: 'Редактировать текст' }) : outside).toBeFocused();
    await page.screenshot({ path: join(artifacts, `${width}-${action}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByText('English persisted', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Язык документа' })).toHaveValue('en');
    assert.equal(writes.length, 1);
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, `${width}-${action}.json`), JSON.stringify({ width, action, writes, errors, result: 'PASS' }, null, 2));
    process.stdout.write(`${width}px ${action}: delayed refetch, focus, content_en, reload PASS\n`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
