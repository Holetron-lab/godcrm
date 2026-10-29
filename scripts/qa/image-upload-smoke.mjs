import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'image-upload-space-'));
const entry = 'src/tests/image-upload-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  const imagePath = '/src/tests/image-settings-fixture/wide.svg';
  const uploadedUrl = '/uploads/spaces/11/fixture-uploaded.svg';
  const row = { id: '20', tableId: '10', data: { supplier: '42', '30': '' } };
  const writes = [];
  const recoveries = [];
  const errors = [];
  let failUpload = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Upload failed|500/.test(message.text())) errors.push(message.text());
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, 'No external requests allowed');
    if (url.pathname === uploadedUrl) {
      return route.fulfill({ contentType: 'image/svg+xml', body: await readFile(join(root, imagePath), 'utf8') });
    }
    if (url.pathname === '/uploads/spaces/11/fixture-protected.svg') {
      const authorized = route.request().headers().authorization === 'Bearer fixture-image-token';
      if (authorized) recoveries.push(url.pathname);
      // Undecodable native response exercises onerror without intentional console errors.
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: authorized
        ? await readFile(join(root, imagePath), 'utf8') : 'Session required' });
    }
    if (url.pathname === '/api/v3/files/upload') {
      assert.equal(route.request().method(), 'POST');
      const multipart = route.request().postData();
      for (const [field, value] of [['tableId', '10'], ['rowId', '20'], ['columnId', '30']]) {
        assert.ok(multipart.includes(`name="${field}"\r\n\r\n${value}\r\n`), `Upload carries ${field}`);
      }
      return route.fulfill({ status: failUpload ? 500 : 200, json: failUpload
        ? { error: { message: 'Fixture upload failure' } }
        : { data: { id: 'file_test', name: 'wide.svg', url: uploadedUrl, spaceId: 11 } } });
    }
    if (url.pathname === '/api/v3/tables/10/rows/20') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        assert.deepEqual(Object.keys(body.data), ['30']);
        writes.push(body);
        Object.assign(row.data, body.data);
      } else assert.equal(route.request().method(), 'GET');
      return route.fulfill({ json: { data: row } });
    }
    assert.ok(!url.pathname.startsWith('/api/'), `Unexpected API: ${url.pathname}`);
    return route.continue();
  });
  const cell = page.getByRole('region', { name: 'Image cell' });
  await page.goto(`${origin}/${entry}`);
  await cell.waitFor();
  await server.waitForRequestsIdle();
  await page.reload();
  const input = cell.locator('input[type=file]');
  await input.setInputFiles(join(root, imagePath));
  await expect.poll(() => writes.length).toBe(1);
  assert.equal(row.data['30'], uploadedUrl);
  assert.equal(row.data.supplier, '42');
  await page.reload();
  await expect(cell.getByRole('img')).toHaveAttribute('src', uploadedUrl);
  await expect.poll(() => cell.getByRole('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.goto(`${origin}/${entry}?prefix`);
  await input.setInputFiles(join(root, imagePath));
  await expect.poll(() => writes.length).toBe(2);
  assert.equal(row.data['30'], `${uploadedUrl},${uploadedUrl}`);
  await expect(cell.getByRole('img')).toHaveCount(2);
  await cell.getByRole('button', { name: 'Remove image' }).first().click();
  await expect.poll(() => writes.length).toBe(3);
  await expect(cell.getByRole('img')).toHaveCount(1);
  failUpload = true;
  await input.setInputFiles(join(root, imagePath));
  await expect(cell.getByRole('alert')).toBeVisible();
  assert.equal(writes.length, 3);
  failUpload = false;
  await input.setInputFiles(join(root, imagePath));
  await expect.poll(() => writes.length).toBe(4);
  await expect(cell.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(cell.getByRole('img')).toHaveCount(2);
  await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations);
  assert.deepEqual(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
  await page.screenshot({ path: join(artifacts, 'after-reload.png') });
  await page.goto(`${origin}/${entry}?readonly`);
  await expect(cell.getByRole('img')).toHaveCount(2);
  await expect(input).toHaveCount(0);
  await expect(cell.getByRole('button', { name: 'Remove image' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(cell.getByRole('button', { name: 'Open image 1' })).toBeFocused();
  for (const readonly of [false, true]) {
    await page.goto(`${origin}/${entry}?carousel${readonly ? '&readonly' : ''}`);
    await expect(cell.getByRole('button', { name: 'Open image 1' })).toBeVisible();
    await expect(cell.locator('button button')).toHaveCount(0);
    for (const key of ['Enter', 'Space']) {
      const open = cell.getByRole('button', { name: 'Open image 1' });
      await open.focus();
      await expect(open).toBeFocused();
      assert.notEqual(await open.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await page.keyboard.press(key);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const tab of ['Tab', 'Shift+Tab']) {
        await page.keyboard.press(tab);
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
      await cell.getByRole('button', { name: 'Next image' }).focus();
      await page.keyboard.press(key);
      await expect(cell.getByText('2 / 2', { exact: true })).toBeVisible();
      await cell.getByRole('button', { name: 'Previous image' }).focus();
      await page.keyboard.press(key);
      await expect(cell.getByText('1 / 2', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('status', { name: 'Parent edit calls' })).toHaveText('0');
    assert.equal(writes.length, 4, 'Preview and carousel must not mutate the row');
    if (readonly) {
      await expect(input).toHaveCount(0);
      await expect(cell.getByRole('button', { name: 'Remove image' })).toHaveCount(0);
    }
    await page.screenshot({ path: join(artifacts, `carousel-${readonly ? 'readonly' : 'editable'}.png`) });
  }
  row.data['30'] = '/uploads/spaces/11/fixture-protected.svg';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/${entry}?readonly&protected`);
  const protectedOpen = cell.getByRole('button', { name: 'Open image 1' });
  await expect.poll(() => protectedOpen.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await protectedOpen.focus();
  await page.keyboard.press('Enter');
  const protectedDialog = page.getByRole('dialog', { name: 'fixture-protected.svg' });
  const fullImage = protectedDialog.getByRole('img');
  await expect.poll(() => fullImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  assert.equal(recoveries.length, 2, 'Thumbnail and chat preview each recover with authorization');
  await protectedDialog.getByTitle('Zoom in').click();
  await expect(fullImage).toHaveAttribute('style', /scale\(1\.25\)/);
  await protectedDialog.getByTitle('Rotate').click();
  await expect(fullImage).toHaveAttribute('style', /rotate\(90deg\)/);
  await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
  const previewViolations = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role=dialog]'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations);
  assert.deepEqual(previewViolations.map(({ id }) => id), []);
  await page.screenshot({ path: join(artifacts, 'protected-preview-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(protectedOpen).toBeFocused();
  assert.equal(writes.length, 4);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ status: 'PASS', writes,
    reload: true, append: true, remove: true, retry: true, readonly: true,
    gridRowKeyboard: ['Enter', 'Space'], focusReturn: true, focusTrap: true, protectedRecoveries: recoveries.length,
    chatPreview: true, zoom: true, rotate: true, accessibility: 'PASS', errors }, null, 2));
  process.stdout.write(`PASS: upload → PUT → reload, append/remove, failure/retry, readonly keyboard. Artifacts: ${artifacts}\n`);
} finally {
  await browser?.close();
  await server.close();
}
