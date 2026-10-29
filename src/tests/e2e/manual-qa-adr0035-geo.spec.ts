/**
 * ADR-0035 Slice 1 + ADR-0035-A (A2 #255276) — geo_point pin chip and the `address`
 * column with its link to the point, on staging.
 *
 * Creates its own `manual-qa-adr0035a-<ts>` table (and deletes it at the end), so the
 * only artifacts carry the `manual-qa-` prefix. Backend contract: A1 #255272
 * (main 8d7bea50, migration 106 applied on staging).
 *
 * PLAYWRIGHT_BASE_URL=https://devcrm.hltrn.cc \
 * QA_EMAIL=qa-admin@manual-test.local QA_PASSWORD=… [QA_PROJECT_ID=…] \
 * npx playwright test manual-qa-adr0035-geo --project=chromium --workers=1
 *
 * Test 1 (AC5 / AC6 / pin chip): address typed in the editor → chip + OSM search URL;
 * point filled → address click goes to OSM by coordinates; the pin chip still renders;
 * no `(lat, lng)` sibling column exists even with the legacy flag on.
 * Test 2 (AC9–AC11): label template on the column, templates in the cell `name`,
 * fallthrough to `formatted`, raw values in the API.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;
const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test.use({ viewport: { width: 1600, height: 1000 } });
test.setTimeout(120_000); // several reloads + API round-trips against staging
test.skip(!email || !password || !/devcrm\.hltrn\.cc|dev\.godcrm\.ai/.test(base), 'Requires QA_EMAIL/QA_PASSWORD and a staging PLAYWRIGHT_BASE_URL');

interface Fixture { token: string; tableId: number; geoColumnId: number; addressColumnId: number; rowId: number }

const api = async (request: APIRequestContext, token: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, data?: unknown) => {
  const res = await request[method](`${base}/api/v3${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
};

const cellOf = async (request: APIRequestContext, f: Fixture, key: string) => {
  const r = await api(request, f.token, 'get', `/tables/${f.tableId}/rows/${f.rowId}`);
  const d = r.body?.data;
  // GET /rows/:id answers { data: { row: { data } } }; keep the older flat shapes as fallbacks.
  return (d?.row?.data ?? d?.data ?? d)?.[key];
};

const setup = async (request: APIRequestContext): Promise<Fixture> => {
  const login = await request.post(`${base}/api/v3/auth/login`, { data: { email, password } });
  expect(login.ok(), 'login').toBeTruthy();
  const token: string = (await login.json()).data.accessToken;

  let projectId = Number(process.env.QA_PROJECT_ID || 0);
  if (!projectId) {
    const projects = await api(request, token, 'get', '/projects');
    const list = projects.body?.data?.projects ?? projects.body?.data ?? [];
    projectId = Number(list[0]?.id);
  }
  expect(projectId, 'a project to host the table').toBeGreaterThan(0);

  // Table keys allow only [A-Za-z0-9_]; the `manual-qa-` artifact prefix goes into display_name.
  const stamp = Date.now();
  const table = await api(request, token, 'post', '/tables', { project_id: projectId, name: `manual_qa_adr0035a_${stamp}`, display_name: `manual-qa-adr0035a-${stamp}`, icon: '🗺️' });
  expect([200, 201], 'create table').toContain(table.status);
  const tableId = Number(table.body.data?.table?.id ?? table.body.data?.id);
  expect(tableId, 'created table id').toBeGreaterThan(0);

  const mk = async (payload: Record<string, unknown>) => {
    const res = await api(request, token, 'post', `/tables/${tableId}/columns`, payload);
    expect(res.status, `create column ${String(payload.name)}`).toBe(201);
    return res.body.data;
  };
  await mk({ name: 'title', display_name: 'Title', column_type: 'text' });
  await mk({ name: 'city', display_name: 'City', column_type: 'text' });
  const geo = await mk({ name: 'where', display_name: 'Where', column_type: 'geo_point' });
  const geoColumnId = Number(geo.id);
  const addr = await mk({ name: 'addr', display_name: 'Addr', column_type: 'address', config: { address: { geo_column_id: geoColumnId } } });
  const addressColumnId = Number(addr.id);
  const addrConfig = typeof addr.config === 'string' ? JSON.parse(addr.config) : addr.config;
  expect(addrConfig.address, 'address config stamped with the link').toMatchObject({ version: 1, geo_column_id: geoColumnId });

  const row = await api(request, token, 'post', `/tables/${tableId}/rows`, { data: { title: 'Склад №2', city: 'Москва' } });
  expect(row.status, 'create row').toBe(201);
  return { token, tableId, geoColumnId, addressColumnId, rowId: Number(row.body.data.id) };
};

const loginUi = async (page: Page) => {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email!);
  await page.fill('input[type="password"]', password!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|spaces|tables/, { timeout: 20000 });
};

const addressChip = (page: Page) => page.getByTestId('address-chip').first();
const pinChip = (page: Page) => page.getByTestId('geo-point-chip').first();
const rawHeader = (page: Page) => page.getByText('Where (lat, lng)', { exact: true });

test('address: editor → OSM search; linked point → OSM by coordinates; pin chip intact; no lat,lng sibling', async ({ page, request }) => {
  const f = await setup(request);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await loginUi(page);
    await page.goto(`/tables/${f.tableId}`);
    const row = page.getByTestId('table-row').first();
    await expect(row).toBeVisible();

    // Empty address cell → editor (formatted autofocused) → Enter saves → chip + OSM search URL.
    const emptyCell = row.getByTestId('table-cell').filter({ has: page.getByTestId('address-empty') }).first();
    await emptyCell.dblclick();
    const editor = page.getByTestId('address-editor');
    await expect(editor).toBeVisible();
    const line = page.getByTestId('address-formatted');
    await expect(line).toBeFocused();
    await line.fill('Тверская 7, Москва');
    await line.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(addressChip(page)).toHaveText(/Тверская 7, Москва/);
    await expect(addressChip(page)).toHaveAttribute('href', /openstreetmap\.org\/search\?query=/);
    await expect.poll(() => cellOf(request, f, 'addr'), { timeout: 10000 }).toEqual({ formatted: 'Тверская 7, Москва' });

    // Empty address line → inline error, nothing lost.
    const addrCell = row.getByTestId('table-cell').filter({ has: page.getByTestId('address-chip') }).first();
    await addrCell.dblclick();
    await page.getByTestId('address-formatted').fill('');
    await page.getByTestId('address-save').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(addressChip(page)).toHaveText(/Тверская 7, Москва/);
    expect(await cellOf(request, f, 'addr')).toEqual({ formatted: 'Тверская 7, Москва' });

    // Fill the linked point: address click now goes to the coordinates; the pin chip renders too.
    const put = await api(request, f.token, 'put', `/tables/${f.tableId}/rows/${f.rowId}`, { data: { where: '55.75, 37.61' } });
    expect(put.status).toBe(200);
    await page.reload();
    await expect(pinChip(page)).toHaveText('📍 55.7500, 37.6100');
    await expect(addressChip(page)).toHaveAttribute('href', /mlat=55\.75&mlon=37\.61/);

    // The legacy raw_sibling flag no longer produces a column (AC6).
    const flag = await api(request, f.token, 'patch', `/tables/${f.tableId}/columns/${f.geoColumnId}`, { config: { geo: { raw_sibling: true } } });
    expect(flag.status).toBe(200);
    await page.reload();
    await expect(pinChip(page)).toHaveText('📍 55.7500, 37.6100');
    await expect(rawHeader(page)).toHaveCount(0);
    const columns = await api(request, f.token, 'get', `/tables/${f.tableId}/columns`);
    const names = (columns.body.data as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['title', 'city', 'where', 'addr']);

    expect(errors, 'no page errors').toEqual([]);
  } finally {
    await api(request, f.token, 'delete', `/tables/${f.tableId}`);
  }
});

test('label templates (AC9–AC11): name_template on the column, {{city}} in the cell name, fallthrough, raw values in the API', async ({ page, request }) => {
  const f = await setup(request);
  try {
    await loginUi(page);

    // AC10: cell name with a template renders substituted; the API returns it raw.
    let put = await api(request, f.token, 'put', `/tables/${f.tableId}/rows/${f.rowId}`, { data: { addr: { formatted: 'Тверская 7, Москва', name: 'Офис {{city}}' } } });
    expect(put.status).toBe(200);
    await page.goto(`/tables/${f.tableId}`);
    await expect(addressChip(page)).toHaveText(/Офис Москва/);
    await expect(addressChip(page)).toHaveAttribute('title', 'Тверская 7, Москва');
    expect(await cellOf(request, f, 'addr')).toMatchObject({ name: 'Офис {{city}}' });

    // AC9: column name_template = {{title}}, cell name cleared → label = title; title edit updates the label, cell untouched.
    const patch = await api(request, f.token, 'patch', `/tables/${f.tableId}/columns/${f.addressColumnId}`, { config: { address: { geo_column_id: f.geoColumnId, name_template: '{{title}}' } } });
    expect(patch.status).toBe(200);
    const stored = typeof patch.body.data.config === 'string' ? JSON.parse(patch.body.data.config) : patch.body.data.config;
    expect(stored.address?.name_template, 'name_template persisted by the backend').toBe('{{title}}');
    put = await api(request, f.token, 'put', `/tables/${f.tableId}/rows/${f.rowId}`, { data: { addr: { formatted: 'Тверская 7, Москва' } } });
    expect(put.status).toBe(200);
    await page.reload();
    await expect(addressChip(page)).toHaveText(/Склад №2/);
    put = await api(request, f.token, 'put', `/tables/${f.tableId}/rows/${f.rowId}`, { data: { title: 'Склад №3' } });
    expect(put.status).toBe(200);
    await page.reload();
    await expect(addressChip(page)).toHaveText(/Склад №3/);
    expect(await cellOf(request, f, 'addr')).toEqual({ formatted: 'Тверская 7, Москва' });

    // AC11: template over an empty column → formatted; nothing resolved is stored anywhere.
    put = await api(request, f.token, 'put', `/tables/${f.tableId}/rows/${f.rowId}`, { data: { title: '' } });
    expect(put.status).toBe(200);
    await page.reload();
    await expect(addressChip(page)).toHaveText(/Тверская 7, Москва/);
    const columns = await api(request, f.token, 'get', `/tables/${f.tableId}/columns`);
    const addrColumn = (columns.body.data as Array<{ id: number; config: unknown }>).find((c) => Number(c.id) === f.addressColumnId)!;
    const cfg = typeof addrColumn.config === 'string' ? JSON.parse(addrColumn.config) : addrColumn.config;
    expect(cfg.address.name_template).toBe('{{title}}');
    expect(JSON.stringify(await cellOf(request, f, 'addr'))).not.toContain('Склад');
  } finally {
    await api(request, f.token, 'delete', `/tables/${f.tableId}`);
  }
});
