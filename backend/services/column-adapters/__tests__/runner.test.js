// @vitest-environment node
/**
 * ADR-204 Stage 2a — DB side: migration 104 applies, preflight counts, apply
 * is atomic and refuses partial columns, undo is exact. Runs on godcrm_test
 * through the committed contour, on fixture rows only (cleanup in afterEach).
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import knex from 'knex';
import { dbAll, dbGet, dbRun } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { up } from '../../../database/migrations/knex/104_adr_0204_s2_content_contact_types.js';
import { preflightColumn, applyColumn, undoColumn } from '../runner.js';
import { kindFromExtension } from '../media-kind.js';

const kindOf = async (url) => kindFromExtension(url);
let ws;
let backupDir;

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const db = knex({ client: 'pg', connection: {
    host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  } });
  try { await up(db); await up(db); /* idempotent */ } finally { await db.destroy(); }
  const def = await dbGet("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'table_columns_type_ratchet'");
  expect(def.def).toContain("'content'");
  expect(def.def).toContain("'contact'");
  expect(def.def).toContain("'image'"); // legacy keys stay admissible
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'adr204-runner', dashboard: false });
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr204-artifact-'));
});
afterEach(async () => {
  await ws?.cleanup();
  fs.rmSync(backupDir, { recursive: true, force: true });
});

async function addColumn(type, name, config = { image: { displayMode: 'stack' } }, defaultValue = null) {
  const r = await dbRun(
    'INSERT INTO table_columns (table_id, column_name, display_name, type, config, default_value) VALUES (?, ?, ?, ?, ?, ?)',
    [ws.tableId, name, name, type, JSON.stringify(config), defaultValue]
  );
  return r.lastInsertRowid;
}
async function addRow(data) {
  return (await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [ws.tableId, `t${Math.random()}`, JSON.stringify(data)])).lastInsertRowid;
}
const rowData = async () => (await dbAll('SELECT data FROM table_rows WHERE table_id = ? ORDER BY id', [ws.tableId])).map((r) => r.data);

describe('image column: preflight → apply → undo', () => {
  it('converts a clean column atomically and restores it exactly', async () => {
    const colId = await addColumn('image', 'pic');
    await addRow({ pic: 'https://cdn/a.jpg', other: 1 });
    await addRow({ pic: ' a.png,b.png ' });
    await addRow({ pic: null });
    await addRow({ other: 2 });            // key absent
    await addRow({ pic: '' });
    const before = await rowData();

    const pre = await preflightColumn(colId, { kindOf });
    expect(pre.ok).toBe(true);
    expect(pre.rows).toBe(5);
    expect(pre.counts).toMatchObject({ convertible: 2, empty: 3, ambiguous: 0, unsupported: 0 });
    expect(pre.column.target).toBe('content');

    const artifact = await applyColumn(colId, { backupDir, kindOf });
    expect((fs.statSync(artifact).mode & 0o777)).toBe(0o600);
    const col = await dbGet('SELECT type, config FROM table_columns WHERE id = ?', [colId]);
    expect(col.type).toBe('content');
    expect(JSON.parse(col.config)).toEqual({ image: { displayMode: 'stack' }, content: { version: 1, mode: 'gallery' } });
    const after = await rowData();
    expect(after[0]).toEqual({ pic: [{ url: 'https://cdn/a.jpg', kind: 'image' }], other: 1 });
    expect(after[1].pic.map((i) => i.url)).toEqual(['a.png', 'b.png']);
    expect(after[2]).toEqual({ pic: null });
    expect(after[3]).toEqual({ other: 2 });  // still absent — no fake key
    expect(after[4]).toEqual({ pic: null });  // '' → null, artifact remembers ''

    // Re-running preflight on the switched column has no adapter → not re-migrated.
    expect((await preflightColumn(colId, { kindOf })).ok).toBe(false);

    await undoColumn(artifact);
    expect(await rowData()).toEqual(before);
    const restored = await dbGet('SELECT type, config FROM table_columns WHERE id = ?', [colId]);
    expect(restored.type).toBe('image');
    expect(JSON.parse(restored.config)).toEqual({ image: { displayMode: 'stack' } });
  });

  it('refuses to publish a partially convertible column — nothing is written', async () => {
    const colId = await addColumn('image', 'pic');
    await addRow({ pic: 'ok.jpg' });
    await addRow({ pic: 'https://res/upload/c_fill,w_300/x.jpg' });
    const pre = await preflightColumn(colId, { kindOf });
    expect(pre.ok).toBe(false);
    expect(pre.counts.ambiguous).toBe(1);
    await expect(applyColumn(colId, { backupDir, kindOf })).rejects.toThrow(/not fully convertible/);
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [colId])).type).toBe('image');
    expect((await rowData())[0]).toEqual({ pic: 'ok.jpg' });
    expect(fs.readdirSync(backupDir)).toEqual([]); // no artifact without an apply
  });

  it('undo is blocked when a value was edited after the switch', async () => {
    const colId = await addColumn('image', 'pic');
    const rowId = await addRow({ pic: 'a.jpg' });
    const artifact = await applyColumn(colId, { backupDir, kindOf });
    await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{pic}', '[{\"url\":\"b.jpg\",\"kind\":\"image\"}]') WHERE id = ?", [rowId]);
    await expect(undoColumn(artifact)).rejects.toThrow(/edited after migration/);
    expect((await dbGet('SELECT type FROM table_columns WHERE id = ?', [colId])).type).toBe('content'); // transaction rolled back
  });
});

describe('other sources', () => {
  it('email → contact keeps the exact string; default_value travels too', async () => {
    const colId = await addColumn('email', 'mail', { icon: '✉️' }, 'x@y.z');
    await addRow({ mail: ' A@B.c' });
    const artifact = await applyColumn(colId, { backupDir, kindOf });
    const col = await dbGet('SELECT type, config, default_value FROM table_columns WHERE id = ?', [colId]);
    expect(col.type).toBe('contact');
    expect(JSON.parse(col.config)).toEqual({ icon: '✉️', contact: { version: 1 } });
    expect(JSON.parse(col.default_value)).toEqual([{ kind: 'external', fields: { email: 'x@y.z' } }]);
    expect((await rowData())[0]).toEqual({ mail: [{ kind: 'external', fields: { email: ' A@B.c' } }] });
    await undoColumn(artifact);
    const back = await dbGet('SELECT type, default_value FROM table_columns WHERE id = ?', [colId]);
    expect(back).toEqual({ type: 'email', default_value: 'x@y.z' });
    expect((await rowData())[0]).toEqual({ mail: ' A@B.c' });
  });

  it('user → contact is unsupported: preflight says so, apply refuses', async () => {
    const colId = await addColumn('user', 'owner', {});
    await addRow({ owner: 5 });
    const pre = await preflightColumn(colId, { kindOf });
    expect(pre.counts.unsupported).toBe(1);
    expect(pre.ok).toBe(false);
    expect(Object.keys(pre.reasons)[0]).toMatch(/user → contact/);
    await expect(applyColumn(colId, { backupDir, kindOf })).rejects.toThrow();
    // Even an empty user column has no mapping to publish.
    const emptyId = await addColumn('user', 'nobody', {});
    expect((await preflightColumn(emptyId, { kindOf })).ok).toBe(false);
  });
});
