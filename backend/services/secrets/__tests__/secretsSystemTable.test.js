// @vitest-environment node
// ADR-0040 §space-secrets — every space owns a `Secrets` system table (same
// shape as Users/Mail: is_system + sync_target in the space's System Data
// project). Reads are space-scoped and masked; ciphertext never leaves `_secrets`.
// DB-backed (godcrm_test, ADR-0009).
import '../../../test/setup.js';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

if (!process.env.SECRETS_MASTER_KEY) {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
}

const { dbRun, dbGet, dbAll } = await import('../../../database/connection.js');
const { PostgresAdapter } = await import('../../../database/adapters/PostgresAdapter.js');
const { default: secretsVault } = await import('../SecretsVault.js');
const { ensureSecretsSystemTableForSpace } = await import('../../SystemTablesCreator.js');
const { getSystemTableData, getSystemTableColumns } = await import('../../SystemTableService.js');
const { createEphemeralWorkspace } = await import('../../../tests/helpers/workspace-fixture.js');
const { lockSecretsSuite, ensureSecretsTable } = await import('../../../tests/helpers/secrets-suite.js');

let ws;
let other;
let adapter;
let releaseSuite;
const createdProjects = [];

afterAll(async () => {
  await dbRun('DELETE FROM _secrets WHERE space_id IN (?, ?)', [ws.spaceId, other.spaceId]);
  for (const pid of createdProjects) {
    const tables = await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [pid]);
    for (const t of tables) {
      await dbRun('DELETE FROM table_columns WHERE table_id = ?', [t.id]);
      await dbRun('DELETE FROM universal_tables WHERE id = ?', [t.id]);
    }
    await dbRun('DELETE FROM projects WHERE id = ?', [pid]);
  }
  await other.cleanup();
  await ws.cleanup();
  try { await secretsVault.shutdown(); } catch { /* ignore */ }
  try { await adapter.close?.(); } catch { /* ignore */ }
  await releaseSuite?.();
});

beforeAll(async () => {
  releaseSuite = await lockSecretsSuite();
  ws = await createEphemeralWorkspace({ label: 'secrets-sys', dashboard: false, table: false });
  other = await createEphemeralWorkspace({ label: 'secrets-other', dashboard: false, table: false });
  adapter = new PostgresAdapter({});
  await adapter.initialize();
  await ensureSecretsTable(adapter);
  await secretsVault.init({ adapter });
}, 120_000);

async function systemProjectOf(spaceId) {
  const p = await dbGet("SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'", [spaceId]);
  if (p && !createdProjects.includes(p.id)) createdProjects.push(p.id);
  return p;
}

describe('ensureSecretsSystemTableForSpace', () => {
  it('creates a Secrets system table in the space System Data project, once', async () => {
    const first = await ensureSecretsSystemTableForSpace(ws.spaceId);
    const second = await ensureSecretsSystemTableForSpace(ws.spaceId);
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    const project = await systemProjectOf(ws.spaceId);
    const table = await dbGet('SELECT project_id, name, is_system, sync_target FROM universal_tables WHERE id = ?', [first]);
    expect(table.project_id).toBe(project.id);
    expect(table.name).toBe('Secrets');
    expect(Number(table.is_system)).toBe(1);
    expect(table.sync_target).toBe('_secrets');

    const cols = await dbAll('SELECT column_name FROM table_columns WHERE table_id = ? ORDER BY order_index', [first]);
    expect(cols.map((c) => c.column_name)).toEqual(getSystemTableColumns('_secrets').map((c) => c.name));
  });

  it('gives a different space its own table', async () => {
    const mine = await ensureSecretsSystemTableForSpace(ws.spaceId);
    const theirs = await ensureSecretsSystemTableForSpace(other.spaceId);
    await systemProjectOf(other.spaceId);
    expect(theirs).not.toBe(mine);
  });
});

describe("getSystemTableData('_secrets')", () => {
  it('lists only the space secrets, masked, without ciphertext', async () => {
    await secretsVault.putSecret('mine_key', 'top-secret', { spaceId: ws.spaceId, description: 'mine' });
    await secretsVault.putSecret('theirs_key', 'other-secret', { spaceId: other.spaceId });

    const project = await systemProjectOf(ws.spaceId);
    const rows = await getSystemTableData('_secrets', project.id);
    expect(rows.map((r) => r.data.key)).toEqual(['mine_key']);
    expect(rows[0].id).toMatch(/^secret-\d+$/);
    expect(rows[0].data.value).toBe('••••••••');
    expect(rows[0].data.description).toBe('mine');
    expect(JSON.stringify(rows)).not.toContain('top-secret');
    expect(JSON.stringify(rows)).not.toContain('encrypted_payload');
  });

  it('returns nothing without a space — there is no global stock', async () => {
    expect(await getSystemTableData('_secrets', null)).toEqual([]);
  });
});
