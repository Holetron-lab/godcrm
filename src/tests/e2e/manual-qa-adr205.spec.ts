/**
 * ADR-205 AC4/AC6/AC7 — read-only acceptance against existing staging fixtures.
 * Fixture manifest: base, gridId, referenceId, first (suffix), second (absolute URL).
 * The grid has scenario, image_comma, image_json, select_single, select_comma,
 * select_json columns and manual-qa-two / manual-qa-missing rows.
 *
 * PLAYWRIGHT_BASE_URL=https://devcrm.hltrn.cc \
 * ADR205_MANIFEST=/tmp/manual-qa-adr205/manifest.json \
 * ADR205_AUTH_STATE=/tmp/manual-qa-adr205/auth.json \
 * npx playwright test manual-qa-adr205 --project=chromium --workers=1
 *
 * No credentials are committed and no database writes are performed here.
 * The fallback test removes only relations/relations_meta from the real rows
 * response; all reference requests still reach the staging API.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Manifest {
  base: string;
  gridId: number;
  referenceId: number;
  first: string;
  second: string;
}

const manifestPath = process.env.ADR205_MANIFEST;
const authState = process.env.ADR205_AUTH_STATE;
const fixture: Manifest | undefined = manifestPath
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : undefined;

test.use({ storageState: authState, viewport: { width: 1920, height: 1000 } });
test.skip(!fixture || !authState, 'Requires ADR205_MANIFEST and ADR205_AUTH_STATE staging fixtures');

const row = (page: Page, scenario: string) =>
  page.getByTestId('table-row').filter({ hasText: scenario });
const cell = (page: Page, scenario: string, index: number) =>
  row(page, scenario).getByTestId('table-cell').nth(index);

test.beforeEach(async ({ baseURL }) => {
  expect(fixture).toBeDefined();
  expect(baseURL).toBe(fixture!.base);
  expect(['https://devcrm.hltrn.cc', 'https://dev.godcrm.ai']).toContain(baseURL);
});

test('AC4/AC7: comma/json galleries, absolute URL, multi-select labels and keyboard preview', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/tables/${fixture!.gridId}`);
  await expect(row(page, 'manual-qa-two')).toBeVisible();

  const expected = [fixture!.base + '/' + fixture!.first, fixture!.second];
  for (const index of [1, 2]) {
    const images = cell(page, 'manual-qa-two', index).getByRole('img');
    await expect(images).toHaveCount(2);
    for (let i = 0; i < expected.length; i++) {
      await expect(images.nth(i)).toHaveAttribute('src', expected[i]);
      await expect.poll(() => images.nth(i).evaluate((image: HTMLImageElement) =>
        image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await expect(cell(page, 'manual-qa-two', index).locator('input[type="file"]')).toHaveCount(0);
  }
  for (const index of [4, 5]) {
    await expect(cell(page, 'manual-qa-two', index)).toContainText(fixture!.first);
    await expect(cell(page, 'manual-qa-two', index)).toContainText(fixture!.second);
    await expect(cell(page, 'manual-qa-missing', index)).toContainText('qa-ghost');
  }

  const preview = cell(page, 'manual-qa-two', 1).getByRole('button').first();
  await preview.focus();
  await expect(preview).toBeFocused();
  await preview.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(preview).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('manual-qa-gallery-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await cell(page, 'manual-qa-two', 1).scrollIntoViewIfNeeded();
  await expect(cell(page, 'manual-qa-two', 1).getByRole('img').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('manual-qa-gallery-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('AC4: raw mode preserves stored image lists and the unresolved key', async ({ page }) => {
  await page.goto(`/tables/${fixture!.gridId}?mode=raw`);
  // Raw mode inserts short_id and id columns before the fixture columns.
  await expect(cell(page, 'manual-qa-two', 3)).toHaveText('qa-a,qa-b');
  await expect(cell(page, 'manual-qa-two', 4)).toHaveText('["qa-a","qa-b"]');
  await expect(cell(page, 'manual-qa-missing', 3)).toHaveText('qa-ghost');
  await expect(cell(page, 'manual-qa-missing', 4)).toHaveText('["qa-ghost"]');
  await expect(row(page, 'manual-qa-two').getByRole('img')).toHaveCount(0);
});

for (const serverMap of [true, false]) {
  test(`AC6: ${serverMap ? 'zero reference requests with server map' : 'one shared reference request without server map'}`, async ({ page }, testInfo) => {
    const referenceRequests: string[] = [];
    const gridRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === `/api/v3/tables/${fixture!.referenceId}/rows` &&
          url.searchParams.get('limit') === '5000') referenceRequests.push(url.href);
      if (url.pathname === `/api/v3/tables/${fixture!.gridId}/rows`) gridRequests.push(url.href);
    });
    if (!serverMap) {
      await page.route(`**/api/v3/tables/${fixture!.gridId}/rows?*`, async route => {
        const response = await route.fetch();
        const json = await response.json();
        delete json.data.relations;
        delete json.data.relations_meta;
        await route.fulfill({ response, json });
      });
    }

    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/v3/tables/${fixture!.gridId}/rows`);
    await page.goto(`/tables/${fixture!.gridId}`);
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    if (serverMap) {
      // Verify the premise, not just the include query parameter.
      for (const column of ['image_comma', 'image_json', 'select_comma', 'select_json']) {
        expect(Object.keys(payload.data.relations[column])).toEqual(['qa-a', 'qa-b']);
      }
    }
    await expect(cell(page, 'manual-qa-two', 4)).toContainText(fixture!.first);
    await expect(cell(page, 'manual-qa-two', 5)).toContainText(fixture!.second);
    // The absence assertion needs a bounded observation window after rendering.
    await page.waitForTimeout(1500);
    await testInfo.attach('manual-qa-network', {
      body: JSON.stringify({ serverMap, gridRequests, referenceRequests }, null, 2),
      contentType: 'application/json',
    });
    expect(gridRequests).toHaveLength(1);
    expect(new URL(gridRequests[0]).searchParams.get('include')).toBe('relations');
    expect(referenceRequests).toHaveLength(serverMap ? 0 : 1);
  });
}
