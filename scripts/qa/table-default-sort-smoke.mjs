import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer } from './browser-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'table-default-sort-'));
const entry = 'src/tests/table-default-sort-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  const errors = [], writes = [], sortRequests = [];
  const rows = ['Архив', 'Заказываем', 'Изучить поставщика'].map((status, index) => ({ id: String(index + 1), tableId: '100965', data: { name: `Поставщик ${index + 1}`, status }, updatedAt: '' }));
  const columns = [{ id: 59191, name: 'name', display_name: 'Поставщик', column_type: 'text', config: {}, order_index: 0 }, { id: 59194, name: 'status', display_name: 'Статус', column_type: 'select', order_index: 1, config: { defaultSort: 'desc', options: ['Заказываем', 'Архив', 'Изучить поставщика'].map(value => ({ value, label: value })) } }];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { errors.push(`External request: ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data;
    if (['/api/v3/spaces', '/api/v3/projects'].includes(url.pathname)) data = [];
    else if (url.pathname === '/api/v3/form-configs/100965') data = null;
    else if (url.pathname === '/api/v3/tables') data = [{ id: 100965, name: 'suppliers', config: {} }];
    else if (url.pathname.endsWith('/columns')) data = columns;
    else if (url.pathname.endsWith('/rows') && request.method() === 'GET') {
      const direction = url.searchParams.get('sortDirection');
      sortRequests.push(direction);
      const ordered = [...rows].sort((a, b) => direction ? (direction === 'desc' ? -1 : 1) * a.data.status.localeCompare(b.data.status, 'ru') : 0);
      data = { rows: ordered, pagination: { page: 1, limit: 50, total: rows.length, pages: 1 } };
    } else if (request.method() === 'PUT' && /\/rows\/\d+$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1), patch = request.postDataJSON().data;
      const row = rows.find(row => row.id === id);
      assert.deepEqual(Object.keys(patch), ['59194']);
      row.data.status = patch['59194'];
      row.updatedAt = new Date().toISOString();
      writes.push({ id, status: row.data.status }); data = { row };
    } else { errors.push(`Unexpected API: ${request.method()} ${url.pathname}`); return route.abort(); }
    return route.fulfill({ json: { success: true, data } });
  });
  const rowNodes = page.getByTestId('table-row');
  const order = () => rowNodes.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-row-id')));
  await page.goto(`${origin}/${entry}`);
  await expect(rowNodes).toHaveCount(3);
  await server.waitForRequestsIdle();
  await page.reload();
  await expect(rowNodes).toHaveCount(3);
  await expect.poll(order).toEqual(['3', '2', '1']);
  await rowNodes.filter({ hasText: 'Поставщик 3' }).getByTestId('table-cell').last().getByRole('button').click();
  await page.locator('button[aria-pressed]').filter({ hasText: /^Архив$/ }).click();
  await expect.poll(() => writes.length).toBe(1);
  assert.deepEqual(writes[0], { id: '3', status: 'Архив' });
  await expect.poll(order).toEqual(['2', '3', '1']);
  await page.reload();
  await expect.poll(order).toEqual(['2', '1', '3']);
  await rowNodes.filter({ hasText: 'Поставщик 1' }).getByTestId('table-cell').last().getByRole('button').click();
  await page.locator('button[aria-pressed]').filter({ hasText: /^Заказываем$/ }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(2);
  assert.deepEqual(writes[1], { id: '1', status: 'Заказываем' });
  await page.reload();
  await expect.poll(order).toEqual(['1', '2', '3']);
  assert.ok(sortRequests.includes('desc'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(artifacts, 'after-reload.png'), fullPage: true });
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ writes, sortRequests, order: await order(), errors }, null, 2));
  console.log(`PASS: status edits persisted by mock API, archive last before/after reload. Artifacts: ${artifacts}`);
} finally { await browser?.close(); await server.close(); }
