// @vitest-environment node
/**
 * ADR-0035 Slice 1 (T2 #254865) — `geo_point` column type: the shared parser
 * (S1.3), the server-side normalizer (S1.4), column config (S1.2), type
 * registration + ratchet migration 105 (S1.5) and the three row write paths.
 * DB-backed parts run on godcrm_test fixture rows (ADR-0009).
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex from 'knex';
import columnsRouter from '../routes/v3/columns.js';
import tablesRouter from '../routes/v3/tables.js';
import { dbGet, dbRun, safeJsonParse } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';
import { parseGeoPoint, formatGeoPoint } from '../../shared/geo-point.js';
import { normalizeGeoValue, GEO_POINT_INVALID } from '../services/geo/geoPoint.js';
import { normalizeTypedCells as normalizeGeoCells } from '../services/cellNormalizers.js';
import { up, down, STAGE3_TYPES } from '../database/migrations/knex/105_adr_0035_s1_geo_point_type.js';
import { STAGE2_TYPES } from '../database/migrations/knex/104_adr_0204_s2_content_contact_types.js';
import { COLUMN_TYPES, VALID_COLUMN_TYPES, persistColumnType, validateColumnConfig } from '../services/ColumnService.js';

const MSK = { lat: 55.75, lng: 37.61 };

describe('parseGeoPoint (S1.3)', () => {
  it.each([
    ['decimal, comma', '55.75, 37.61', MSK],
    ['decimal, semicolon', '55.75;37.61', MSK],
    ['decimal, whitespace', '55.75 37.61', MSK],
    ['decimal, negative', '-33.8688, 151.2093', { lat: -33.8688, lng: 151.2093 }],
    ['DMS unicode', '55°45′N 37°37′E', { lat: 55.75, lng: 37.616667 }],
    ['DMS ascii with seconds', `55°45'0" N, 37°36'36" E`, { lat: 55.75, lng: 37.61 }],
    ['DMS hemisphere-first order lng,lat', '37°37′E 55°45′N', { lat: 55.75, lng: 37.616667 }],
    ['DMS south/west', '33°52′S 151°12′W', { lat: -33.866667, lng: -151.2 }],
    ['gmaps @', 'https://www.google.com/maps/@55.75,37.61,15z', MSK],
    ['gmaps q=', 'https://maps.google.com/?q=55.75,37.61', MSK],
    ['gmaps q= encoded', 'https://www.google.com/maps?q=55.75%2C37.61&z=12', MSK],
    ['gmaps !3d!4d', 'https://www.google.com/maps/place/x/@55.7,37.6,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d55.75!4d37.61', MSK],
    ['object', { lat: 55.75, lng: 37.61, accuracy_m: 5 }, MSK],
    ['object with numeric strings', { lat: '55.75', lng: '37.61' }, MSK],
    ['GeoJSON Point ([lng, lat])', { type: 'Point', coordinates: [37.61, 55.75] }, MSK],
    ['bare [lng, lat]', [37.61, 55.75], MSK],
  ])('accepts %s', (_label, input, expected) => {
    const p = parseGeoPoint(input);
    expect(p).not.toBeNull();
    expect(p.lat).toBeCloseTo(expected.lat, 5);
    expect(p.lng).toBeCloseTo(expected.lng, 5);
    expect(Object.keys(p).sort()).toEqual(['lat', 'lng']);
  });

  it.each([
    ['garbage', 'abc'],
    ['single number', '55.75'],
    ['three numbers', '55.75, 37.61, 12'],
    ['lat out of range', '95, 0'],
    ['lng out of range', '0, 181'],
    ['object lat out of range', { lat: 95, lng: 0 }],
    ['object missing lng', { lat: 55.75 }],
    ['empty string', '   '],
    ['null', null],
    ['number', 55.75],
    ['url without coordinates', 'https://www.google.com/maps/place/Moscow'],
    ['one DMS token', '55°45′N'],
  ])('rejects %s', (_label, input) => {
    expect(parseGeoPoint(input)).toBeNull();
  });
});

describe('formatGeoPoint (S1.3)', () => {
  it('fixes 6 decimals by default, honours precision, empty for no point', () => {
    expect(formatGeoPoint(MSK)).toBe('55.750000, 37.610000');
    expect(formatGeoPoint({ lat: -33.8688, lng: 151.2093 }, { precision: 4 })).toBe('-33.8688, 151.2093');
    expect(formatGeoPoint(null)).toBe('');
    expect(formatGeoPoint({ lat: 95, lng: 0 })).toBe('');
    expect(parseGeoPoint(formatGeoPoint(MSK))).toEqual(MSK);
  });
});

describe('normalizeGeoCells (S1.4)', () => {
  const cols = [
    { id: 7, column_name: 'where', type: 'geo_point' },
    { id: 8, column_name: 'title', type: 'text' },
  ];

  it('null and empty string clear the cell; untouched keys pass through', () => {
    expect(normalizeGeoCells(cols, { where: null, title: 'x' })).toEqual({ ok: true, data: { where: null, title: 'x' } });
    expect(normalizeGeoCells(cols, { where: '' })).toEqual({ ok: true, data: { where: null } });
    expect(normalizeGeoCells(cols, { title: '95, 0' })).toEqual({ ok: true, data: { title: '95, 0' } });
    expect(normalizeGeoCells(cols, {})).toEqual({ ok: true, data: {} });
  });

  it('a string becomes {lat, lng, source: raw} and drops the optional bag', () => {
    expect(normalizeGeoCells(cols, { where: '59.93, 30.33' })).toEqual({ ok: true, data: { where: { lat: 59.93, lng: 30.33, source: 'raw' } } });
  });

  it('an object is range-checked, unknown keys stripped, source defaults to paste', () => {
    const r = normalizeGeoCells(cols, { where: { lat: 55.75, lng: 37.61, accuracy_m: '8', captured_at: '2026-10-21T10:00:00Z', foo: 1 } });
    expect(r).toEqual({ ok: true, data: { where: { lat: 55.75, lng: 37.61, accuracy_m: 8, captured_at: '2026-10-21T10:00:00Z', source: 'paste' } } });
    expect(normalizeGeoCells(cols, { where: { lat: 1, lng: 2, source: 'gps' } }).data.where.source).toBe('gps');
    expect(normalizeGeoCells(cols, { where: { type: 'Point', coordinates: [37.61, 55.75] } }).data.where).toEqual({ lat: 55.75, lng: 37.61, source: 'paste' });
  });

  it('matches the column id key on create payloads', () => {
    expect(normalizeGeoCells(cols, { 7: '1, 2' })).toEqual({ ok: true, data: { 7: { lat: 1, lng: 2, source: 'raw' } } });
  });

  it.each([
    ['unparseable string', 'abc'],
    ['out of range object', { lat: 95, lng: 0 }],
    ['bad metadata number', { lat: 1, lng: 2, accuracy_m: 'near' }],
    ['bad captured_at', { lat: 1, lng: 2, captured_at: 'yesterday' }],
    ['unknown source', { lat: 1, lng: 2, source: 'satellite' }],
    ['array of wrong arity', [1, 2, 3]],
  ])('rejects %s with 400 geo_point_invalid', (_label, value) => {
    const r = normalizeGeoCells(cols, { where: value });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 400, code: GEO_POINT_INVALID, meta: { column: 'where' } });
    expect(r.message).toMatch(/^Column 'where': /);
    expect(normalizeGeoValue(value).ok).toBe(false);
  });
});

describe('type registration + config (S1.2, S1.5)', () => {
  it('geo_point is canon, persistable, and in the 105 ratchet set', () => {
    expect(COLUMN_TYPES).toContain('geo_point');
    expect(VALID_COLUMN_TYPES).toContain('geo_point');
    expect(persistColumnType('geo_point')).toBe('geo_point');
    expect(STAGE3_TYPES).toEqual([...STAGE2_TYPES, 'geo_point'].sort());
    expect(STAGE2_TYPES).not.toContain('geo_point');
  });

  it('validateColumnConfig stamps {version, raw_sibling, indexed} and refuses bad values', () => {
    expect(validateColumnConfig('geo_point', null)).toEqual({ ok: true, normalized: { geo: { version: 1, raw_sibling: false, indexed: false } } });
    expect(validateColumnConfig('geo_point', { icon: '📍', geo: { raw_sibling: true } }).normalized)
      .toEqual({ icon: '📍', geo: { version: 1, raw_sibling: true, indexed: false } });
    expect(validateColumnConfig('geo_point', { geo: { version: 2 } }).ok).toBe(false);
    expect(validateColumnConfig('geo_point', { geo: { raw_sibling: 'yes' } }).ok).toBe(false);
    expect(validateColumnConfig('geo_point', { geo: { indexed: 1 } }).ok).toBe(false);
  });
});

describe('write paths on godcrm_test (S1.5, S1.7)', () => {
  let ws;
  let db;
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, userId: ws.userId, role: 'owner' }; next(); }, columnsRouter, tablesRouter);

  const createColumn = async (name = 'where', config) => {
    const res = await request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name, display_name: name, column_type: 'geo_point', ...(config ? { config } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  };
  const createRow = (data) => request(app).post(`/api/v3/tables/${ws.tableId}/rows`).send({ data });
  const updateRow = (rowId, data) => request(app).put(`/api/v3/tables/${ws.tableId}/rows/${rowId}`).send({ data });
  const batchUpdate = (updates) => request(app).post(`/api/v3/tables/${ws.tableId}/rows/batch-update`).send({ updates });
  // `table_rows.data` is jsonb on the test contour and text elsewhere — accept both.
  const stored = async (rowId) => safeJsonParse((await dbGet('SELECT data FROM table_rows WHERE id = ?', [rowId])).data);

  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    db = knex({ client: 'pg', connection: {
      host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    } });
    await up(db);
    return async () => { await db.destroy(); };
  });
  beforeEach(async () => {
    // Re-apply 105 each test: the ADR-204 suite calls `up(104)` on the same
    // shared DB, which narrows the CHECK back to STAGE2 whenever it runs.
    await up(db);
    ws = await createEphemeralWorkspace({ label: 'adr0035-geo', dashboard: false });
  });
  afterEach(async () => { await ws?.cleanup(); });

  it('POST /columns geo_point → 201 with config.geo stamped; GET /columns carries type + config, no raw sibling', async () => {
    const col = await createColumn();
    expect(col.column_type).toBe('geo_point');
    expect(col.config.geo).toEqual({ version: 1, raw_sibling: false, indexed: false });

    const list = await request(app).get(`/api/v3/tables/${ws.tableId}/columns`);
    expect(list.status).toBe(200);
    const mine = list.body.data.filter((c) => c.name === 'where' || String(c.name).startsWith('__geo_raw'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ column_type: 'geo_point', config: { geo: { version: 1, raw_sibling: false, indexed: false } } });

    const bad = await request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name: 'bad', display_name: 'Bad', column_type: 'geo_point', config: { geo: { version: 2 } } });
    expect(bad.status).toBe(400);
  });

  it('PATCH config.geo.raw_sibling=true → 200; schema API still has no __geo_raw_* column', async () => {
    const col = await createColumn();
    const patch = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${col.id}`).send({ config: { geo: { raw_sibling: true } } });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.data.config.geo).toEqual({ version: 1, raw_sibling: true, indexed: false });
    expect(JSON.parse((await dbGet('SELECT config FROM table_columns WHERE id = ?', [col.id])).config).geo.raw_sibling).toBe(true);

    const list = await request(app).get(`/api/v3/tables/${ws.tableId}/columns`);
    expect(list.body.data.map((c) => c.name)).not.toContain(`__geo_raw_${col.id}`);
    expect(await dbGet('SELECT count(*)::int AS n FROM table_columns WHERE table_id = ?', [ws.tableId])).toEqual({ n: 1 });

    const bad = await request(app).patch(`/api/v3/tables/${ws.tableId}/columns/${col.id}`).send({ config: { geo: { raw_sibling: 'on' } } });
    expect(bad.status).toBe(400);
  });

  it('create: object is stored with source paste; string → raw; invalid → 400 geo_point_invalid', async () => {
    await createColumn();
    const a = await createRow({ where: { lat: 55.75, lng: 37.61, accuracy_m: 8, junk: 1 } });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await stored(a.body.data.id)).where).toEqual({ lat: 55.75, lng: 37.61, accuracy_m: 8, source: 'paste' });

    const b = await createRow({ where: '59.93, 30.33' });
    expect(b.status).toBe(201);
    expect((await stored(b.body.data.id)).where).toEqual({ lat: 59.93, lng: 30.33, source: 'raw' });

    const c = await createRow({ where: 'abc' });
    expect(c.status).toBe(400);
    expect(c.body.error).toMatchObject({ code: GEO_POINT_INVALID, details: { column: 'where' } });
    expect(await dbGet('SELECT count(*)::int AS n FROM table_rows WHERE table_id = ?', [ws.tableId])).toEqual({ n: 2 });
  });

  it('update: a string replaces lat/lng and drops the optional bag; invalid leaves the row untouched', async () => {
    await createColumn();
    const created = await createRow({ where: { lat: 55.75, lng: 37.61, accuracy_m: 8, captured_at: '2026-10-21T10:00:00Z', source: 'gps' } });
    const rowId = created.body.data.id;
    expect((await stored(rowId)).where.source).toBe('gps');

    const put = await updateRow(rowId, { where: '59.93, 30.33' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await stored(rowId)).where).toEqual({ lat: 59.93, lng: 30.33, source: 'raw' });

    for (const bad of ['abc', { lat: 95, lng: 0 }]) {
      const res = await updateRow(rowId, { where: bad });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(GEO_POINT_INVALID);
      expect((await stored(rowId)).where).toEqual({ lat: 59.93, lng: 30.33, source: 'raw' });
    }

    const clear = await updateRow(rowId, { where: null });
    expect(clear.status).toBe(200);
    expect((await stored(rowId)).where).toBeNull();
  });

  it('batch: same rules per row; a bad point fails only its own row', async () => {
    await createColumn();
    const r1 = (await createRow({ where: '1, 2' })).body.data.id;
    const r2 = (await createRow({ where: '3, 4' })).body.data.id;
    const res = await batchUpdate([
      { rowId: r1, data: { where: '55.75, 37.61' } },
      { rowId: r2, data: { where: 'nowhere' } },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.errors).toEqual([{ rowId: String(r2), code: GEO_POINT_INVALID, error: expect.stringMatching(/^Column 'where'/) }]);
    expect((await stored(r1)).where).toEqual({ lat: 55.75, lng: 37.61, source: 'raw' });
    expect((await stored(r2)).where).toEqual({ lat: 3, lng: 4, source: 'raw' });
  });

  it('migration 105: down refuses while a geo_point column exists, then down/up round-trip', async () => {
    const col = await createColumn();
    await expect(down(db)).rejects.toThrow(/geo_point \(1\)/);
    await dbRun('DELETE FROM table_columns WHERE id = ?', [col.id]);
    await down(db);
    await expect(dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, config) VALUES (?, 'g', 'g', 'geo_point', '{}')", [ws.tableId]))
      .rejects.toThrow(/table_columns_type_ratchet/);
    await up(db);
    await up(db); // idempotent
    await createColumn('again');
  });
});
