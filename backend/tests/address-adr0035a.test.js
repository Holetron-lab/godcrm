// @vitest-environment node
/**
 * ADR-0035-A (A1 #255272) — `address` column type: registration + ratchet
 * migration 106, `config.address` contract and link integrity (AC1, AC4),
 * value normalization through the REST write paths, MCP data-tools and import
 * (AC2, AC3). DB-backed parts run on godcrm_test fixture rows (ADR-0009).
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex from 'knex';
import columnsRouter from '../routes/v3/columns.js';
import tablesRouter from '../routes/v3/tables.js';
import { dbGet, dbRun, safeJsonParse } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';
import { ADDRESS_INVALID } from '../services/geo/address.js';
import { up, down, STAGE4_TYPES } from '../database/migrations/knex/106_adr_0035_a_address_type.js';
import { STAGE3_TYPES } from '../database/migrations/knex/105_adr_0035_s1_geo_point_type.js';
import { COLUMN_TYPES, VALID_COLUMN_TYPES, persistColumnType, validateColumnConfig } from '../services/ColumnService.js';
import { dataToolHandlers } from '../services/agent-tools/data-tools.js';
import { ImportService } from '../services/ImportService.js';

const LINE = 'Тверская 7, Москва';
const EMPTY_GEOCODER = { secret_key: null, provider: null };

describe('type registration + config (ADR-0035-A)', () => {
  it('address is canon, persistable, and in the 106 ratchet set', () => {
    expect(COLUMN_TYPES).toContain('address');
    expect(VALID_COLUMN_TYPES).toContain('address');
    expect(persistColumnType('address')).toBe('address');
    expect(STAGE4_TYPES).toEqual([...STAGE3_TYPES, 'address'].sort());
    expect(STAGE3_TYPES).not.toContain('address');
  });

  it('validateColumnConfig stamps {version, geo_column_id, name_template, geocoder}, keeps geocoder verbatim, refuses bad shapes', () => {
    expect(validateColumnConfig('address', null))
      .toEqual({ ok: true, normalized: { address: { version: 1, geo_column_id: null, name_template: null, geocoder: EMPTY_GEOCODER } } });
    expect(validateColumnConfig('address', { icon: '📮', address: { geo_column_id: '42', geocoder: { secret_key: 'dadata_api_key', provider: 'dadata' } } }).normalized)
      .toEqual({ icon: '📮', address: { version: 1, geo_column_id: 42, name_template: null, geocoder: { secret_key: 'dadata_api_key', provider: 'dadata' } } });
    expect(validateColumnConfig('address', { address: { geo_column_id: 0 } }).ok).toBe(false);
    expect(validateColumnConfig('address', { address: { geo_column_id: 'abc' } }).ok).toBe(false);
    expect(validateColumnConfig('address', { address: { geocoder: { provider: 7 } } }).ok).toBe(false);
  });

  it('§Amendment 1: name_template is stored verbatim (trimmed), null/absent/blank → null, > 200 or non-string → refused', () => {
    const tpl = (name_template) => validateColumnConfig('address', { address: { name_template } });
    expect(tpl('{{title}}').normalized.address.name_template).toBe('{{title}}');
    expect(tpl('  Офис {{city}}  ').normalized.address.name_template).toBe('Офис {{city}}');
    expect(tpl(null).normalized.address.name_template).toBeNull();
    expect(tpl('   ').normalized.address.name_template).toBeNull();
    expect(tpl('x'.repeat(200)).ok).toBe(true);
    expect(tpl('x'.repeat(201))).toEqual({ ok: false, error: expect.stringContaining('name_template') });
    expect(tpl(7).ok).toBe(false);
    expect(tpl({ a: 1 }).ok).toBe(false);
  });
});

describe('write paths on godcrm_test (ADR-0035-A AC1–AC4)', () => {
  let ws;
  let db;
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, userId: ws.userId, role: 'owner' }; next(); }, columnsRouter, tablesRouter);

  const postColumn = (name, column_type, config) => request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
    .send({ name, display_name: name, column_type, ...(config ? { config } : {}) });
  const createColumn = async (name, column_type, config) => {
    const res = await postColumn(name, column_type, config);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  };
  const listColumns = async () => (await request(app).get(`/api/v3/tables/${ws.tableId}/columns`)).body.data;
  const createRow = (data) => request(app).post(`/api/v3/tables/${ws.tableId}/rows`).send({ data });
  const updateRow = (rowId, data) => request(app).put(`/api/v3/tables/${ws.tableId}/rows/${rowId}`).send({ data });
  const batchUpdate = (updates) => request(app).post(`/api/v3/tables/${ws.tableId}/rows/batch-update`).send({ updates });
  const stored = async (rowId) => safeJsonParse((await dbGet('SELECT data FROM table_rows WHERE id = ?', [rowId])).data);
  const storedConfig = async (colId) => JSON.parse((await dbGet('SELECT config FROM table_columns WHERE id = ?', [colId])).config);

  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    db = knex({ client: 'pg', connection: {
      host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    } });
    return async () => { await db.destroy(); };
  });
  beforeEach(async () => {
    // Re-apply 106 each test: the ADR-204 / ADR-0035 suites call `up(104)` /
    // `up(105)` on the same shared DB, which narrows the CHECK back.
    await up(db);
    ws = await createEphemeralWorkspace({ label: 'adr0035a-addr', dashboard: false });
  });
  afterEach(async () => { await ws?.cleanup(); });

  it('AC1: POST /columns address → 201 with config.address stamped; link to a geo_point of this table accepted', async () => {
    const geo = await createColumn('where', 'geo_point');
    const addr = await createColumn('addr', 'address', { address: { geo_column_id: geo.id } });
    expect(addr.column_type).toBe('address');
    expect(addr.config.address).toEqual({ version: 1, geo_column_id: geo.id, name_template: null, geocoder: EMPTY_GEOCODER });

    const mine = (await listColumns()).find((c) => c.name === 'addr');
    expect(mine).toMatchObject({ column_type: 'address', config: { address: { version: 1, geo_column_id: geo.id } } });
    const plain = await createColumn('addr2', 'address');
    expect(plain.config.address).toEqual({ version: 1, geo_column_id: null, name_template: null, geocoder: EMPTY_GEOCODER });
  });

  it('AC1: link to a non-geo_point column or a column of another table → 400 ADDRESS_GEO_LINK_INVALID', async () => {
    const text = await createColumn('title', 'text');
    const bad = await postColumn('addr', 'address', { address: { geo_column_id: text.id } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('ADDRESS_GEO_LINK_INVALID');

    const other = await createEphemeralWorkspace({ label: 'adr0035a-other', dashboard: false });
    try {
      const foreignGeo = await request(app).post(`/api/v3/tables/${other.tableId}/columns`)
        .send({ name: 'where', display_name: 'where', column_type: 'geo_point' });
      expect(foreignGeo.status).toBe(201);
      const cross = await postColumn('addr', 'address', { address: { geo_column_id: foreignGeo.body.data.id } });
      expect(cross.status).toBe(400);
      expect(cross.body.error.code).toBe('ADDRESS_GEO_LINK_INVALID');
      const ghost = await postColumn('addr', 'address', { address: { geo_column_id: 999999999 } });
      expect(ghost.status).toBe(400);
    } finally {
      await other.cleanup();
    }
    expect(await dbGet('SELECT count(*)::int AS n FROM table_columns WHERE table_id = ? AND type = ?', [ws.tableId, 'address'])).toEqual({ n: 0 });
  });

  it('AC1/AC3: PATCH config.address — link validated, geocoder.* stored verbatim; GET /columns echoes it', async () => {
    const geo = await createColumn('where', 'geo_point');
    const addr = await createColumn('addr', 'address');
    const patch = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${addr.id}`)
      .send({ config: { address: { geo_column_id: geo.id, geocoder: { secret_key: 'dadata_api_key', provider: 'dadata' } } } });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.data.config.address).toEqual({ version: 1, geo_column_id: geo.id, name_template: null, geocoder: { secret_key: 'dadata_api_key', provider: 'dadata' } });
    expect((await storedConfig(addr.id)).address.geocoder).toEqual({ secret_key: 'dadata_api_key', provider: 'dadata' });

    const text = await createColumn('title', 'text');
    const bad = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${addr.id}`).send({ config: { address: { geo_column_id: text.id } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('ADDRESS_GEO_LINK_INVALID');
    expect((await storedConfig(addr.id)).address.geo_column_id).toBe(geo.id);
  });

  it('§Amendment 1 (test_steps 9): PATCH name_template round-trips verbatim through GET /columns; null clears; 201 chars / number → 400; cell name keeps {{…}} raw', async () => {
    const addr = await createColumn('addr', 'address');
    const patchTpl = (name_template) => request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${addr.id}`).send({ config: { address: { name_template } } });

    const set = await patchTpl('{{title}}');
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data.config.address.name_template).toBe('{{title}}');
    expect((await listColumns()).find((c) => c.id === addr.id).config.address.name_template).toBe('{{title}}');
    expect((await storedConfig(addr.id)).address.name_template).toBe('{{title}}');

    expect((await patchTpl('x'.repeat(201))).status).toBe(400);
    expect((await patchTpl(7)).status).toBe(400);
    expect((await storedConfig(addr.id)).address.name_template).toBe('{{title}}');

    const cleared = await patchTpl(null);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.config.address.name_template).toBeNull();

    const row = await createRow({ addr: { formatted: LINE, name: 'Офис {{city}}' } });
    expect(row.status, JSON.stringify(row.body)).toBe(201);
    expect((await stored(row.body.data.id)).addr).toEqual({ formatted: LINE, name: 'Офис {{city}}' });
  });

  it('AC2: create — string → {formatted}; object → allowlist, empties dropped; missing formatted / too long → 400 address_invalid', async () => {
    await createColumn('addr', 'address');
    const a = await createRow({ addr: LINE });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await stored(a.body.data.id)).addr).toEqual({ formatted: LINE });

    const b = await createRow({ addr: { formatted: LINE, name: 'Офис', city: 'Москва', foo: 'bar', unit: '' } });
    expect(b.status).toBe(201);
    expect((await stored(b.body.data.id)).addr).toEqual({ formatted: LINE, name: 'Офис', city: 'Москва' });

    for (const bad of [{ name: 'Офис' }, { formatted: 'x'.repeat(513) }, 'x'.repeat(513), 42]) {
      const res = await createRow({ addr: bad });
      expect(res.status, JSON.stringify(bad).slice(0, 40)).toBe(400);
      expect(res.body.error).toMatchObject({ code: ADDRESS_INVALID, details: { column: 'addr' } });
    }
    expect(await dbGet('SELECT count(*)::int AS n FROM table_rows WHERE table_id = ?', [ws.tableId])).toEqual({ n: 2 });
  });

  it('AC2/AC3: update — same rules; provider keys round-trip; null and "" clear; invalid leaves the row untouched', async () => {
    await createColumn('addr', 'address');
    const rowId = (await createRow({ addr: LINE })).body.data.id;

    const put = await updateRow(rowId, { addr: { formatted: LINE, provider: 'dadata', provider_place_id: 'fias-123' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await stored(rowId)).addr).toEqual({ formatted: LINE, provider: 'dadata', provider_place_id: 'fias-123' });

    const bad = await updateRow(rowId, { addr: { name: 'Офис' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ADDRESS_INVALID);
    expect((await stored(rowId)).addr).toEqual({ formatted: LINE, provider: 'dadata', provider_place_id: 'fias-123' });

    expect((await updateRow(rowId, { addr: '' })).status).toBe(200);
    expect((await stored(rowId)).addr).toBeNull();
    expect((await updateRow(rowId, { addr: LINE })).status).toBe(200);
    expect((await updateRow(rowId, { addr: null })).status).toBe(200);
    expect((await stored(rowId)).addr).toBeNull();
  });

  it('AC2: batch — a bad address fails only its own row', async () => {
    await createColumn('addr', 'address');
    const r1 = (await createRow({ addr: 'a' })).body.data.id;
    const r2 = (await createRow({ addr: 'b' })).body.data.id;
    const res = await batchUpdate([
      { rowId: r1, data: { addr: LINE } },
      { rowId: r2, data: { addr: { city: 'Москва' } } },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.errors).toEqual([{ rowId: String(r2), code: ADDRESS_INVALID, error: expect.stringMatching(/^Column 'addr'/) }]);
    expect((await stored(r1)).addr).toEqual({ formatted: LINE });
    expect((await stored(r2)).addr).toEqual({ formatted: 'b' });
  });

  it('MCP data-tools: add / update / batch_update rows go through the same normalizer', async () => {
    await createColumn('addr', 'address');
    await createColumn('where', 'geo_point');
    const added = await dataToolHandlers.add_table_row({ table_id: ws.tableId, data: { addr: LINE, where: '55.75, 37.61' } }, ws.userId);
    expect(added.error, JSON.stringify(added)).toBeUndefined();
    const rowId = added.row_id;
    expect((await stored(rowId))).toMatchObject({ addr: { formatted: LINE }, where: { lat: 55.75, lng: 37.61, source: 'raw' } });

    const rejected = await dataToolHandlers.add_table_row({ table_id: ws.tableId, data: { addr: { name: 'x' } } }, ws.userId);
    expect(rejected.error).toMatch(/^Column 'addr'/);
    expect(rejected.rejected_fields).toEqual([{ column: 'addr', code: ADDRESS_INVALID }]);

    const upd = await dataToolHandlers.update_table_row({ table_id: ws.tableId, row_id: rowId, data: { addr: { formatted: 'Арбат 1', foo: 1 } } }, ws.userId);
    expect(upd.error, JSON.stringify(upd)).toBeUndefined();
    expect((await stored(rowId)).addr).toEqual({ formatted: 'Арбат 1' });
    const updBad = await dataToolHandlers.update_table_row({ table_id: ws.tableId, row_id: rowId, data: { where: 'nowhere' } }, ws.userId);
    expect(updBad.error).toMatch(/^Column 'where'/);

    const batch = await dataToolHandlers.batch_update_rows({ table_id: ws.tableId, updates: [
      { row_id: rowId, data: { addr: LINE } },
    ] }, ws.userId);
    expect(batch.error, JSON.stringify(batch)).toBeUndefined();
    expect((await stored(rowId)).addr).toEqual({ formatted: LINE });
    const batchBad = await dataToolHandlers.batch_update_rows({ table_id: ws.tableId, updates: [{ row_id: rowId, data: { addr: 7 } }] }, ws.userId);
    expect(batchBad.failed).toEqual([expect.objectContaining({ row_id: rowId, rejected_fields: [{ column: 'addr', code: ADDRESS_INVALID }] })]);
    expect((await stored(rowId)).addr).toEqual({ formatted: LINE });
  });

  it('ImportService: address cells are normalized on import; a bad one rolls the import back', async () => {
    const payload = (rows) => ({
      type: 'table',
      table: { name: `manual-qa-adr0035a-${ws.token}` },
      columns: [{ name: 'addr', displayName: 'addr', columnType: 'address' }],
      rows,
    });
    const ok = await ImportService.importTable(ws.projectId, payload([{ addr: LINE }, { addr: { formatted: 'Арбат 1', foo: 'x' } }]), {});
    expect(ok.rowsImported).toBe(2);
    expect(await dbGet('SELECT count(*)::int AS n FROM table_rows WHERE table_id = ?', [ok.tableId])).toEqual({ n: 2 });
    const data = await dbGet("SELECT data FROM table_rows WHERE table_id = ? AND data::jsonb->'addr'->>'formatted' = 'Арбат 1'", [ok.tableId]);
    expect(safeJsonParse(data.data).addr).toEqual({ formatted: 'Арбат 1' });

    await expect(ImportService.importTable(ws.projectId, payload([{ addr: LINE }, { addr: { city: 'Москва' } }]), {}))
      .rejects.toThrow(/^Column 'addr'/);
    const ghost = await dbGet('SELECT id FROM universal_tables WHERE project_id = ? AND id <> ? AND id <> ?', [ws.projectId, ws.tableId, ok.tableId]);
    expect(ghost).toBeFalsy();
    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [ok.tableId]);
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [ok.tableId]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [ok.tableId]);
  });

  it('AC4: DELETE the linked geo_point → dependents get geo_column_id null; retyping it while linked → 400 GEO_COLUMN_IN_USE', async () => {
    const geo = await createColumn('where', 'geo_point');
    const addr = await createColumn('addr', 'address', { address: { geo_column_id: geo.id, geocoder: { secret_key: 'k', provider: 'photon' } } });
    const unrelated = await createColumn('addr2', 'address');

    const retype = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${geo.id}`).send({ column_type: 'text' });
    expect(retype.status).toBe(400);
    expect(retype.body.error.code).toBe('GEO_COLUMN_IN_USE');
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [geo.id])).type).toBe('geo_point');

    const del = await request(app).delete(`/api/v3/tables/${ws.tableId}/columns/${geo.id}`);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const after = await listColumns();
    expect(after.find((c) => c.id === addr.id).config.address).toEqual({ version: 1, geo_column_id: null, name_template: null, geocoder: { secret_key: 'k', provider: 'photon' } });
    expect(after.find((c) => c.id === unrelated.id).config.address.geo_column_id).toBeNull();
    expect(after.find((c) => c.id === geo.id)).toBeUndefined();

    // Unlinked now: retyping the (re-created) point is allowed.
    const geo2 = await createColumn('where2', 'geo_point');
    expect((await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${geo2.id}`).send({ column_type: 'text' })).status).toBe(200);
  });

  it('migration 106: down refuses while an address column exists, then down/up round-trip', async () => {
    const col = await createColumn('addr', 'address');
    await expect(down(db)).rejects.toThrow(/address \(1\)/);
    await dbRun('DELETE FROM table_columns WHERE id = ?', [col.id]);
    await down(db);
    await expect(dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, config) VALUES (?, 'a', 'a', 'address', '{}')", [ws.tableId]))
      .rejects.toThrow(/table_columns_type_ratchet/);
    await up(db);
    await up(db); // idempotent
    await createColumn('again', 'address');
  });
});
