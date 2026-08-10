/**
 * AgentVersionService integration tests — ADR-0007-S G1-data acceptance.
 *
 * Proves the three ADR-0007-S §7 acceptance criteria against a real Postgres:
 *   #1  mint one agent → exactly one active row
 *   #2  promote v2 → v1 retired, v2 active (atomic, never two active)
 *   #3  FK / service rejects an orphan version (no matching agent row)
 *
 * @requires migration 073 applied + `table_rows` present (godcrm_test is a
 *           migrated sync of prod, so both hold there — ADR-0009).
 *
 * Gated behind TEST_POSTGRES=true: on the prod-marked host the ADR-0009 boot
 * guard hard-aborts the whole run (POSTGRES_DB=godcrm_prod), so this suite is
 * meant for the DEV-local godcrm_test cycle / CI, never the prod box.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  AGENTS_TABLE_ID,
  mintAgentVersion,
  promoteAgentVersion,
  retireAgentVersion,
  listAgentVersions,
  getActiveVersion,
} from '../AgentVersionService.js';
import { dbRun, dbGet, dbAll, destroyAdapter } from '../../database/connection.js';

const runPg = process.env.TEST_POSTGRES === 'true';

describe.skipIf(!runPg)('AgentVersionService (ADR-0007-S G1-data)', () => {
  let agentA; // throwaway AI-Agents row id
  let agentB;
  let notAgent; // a non-agent row (wrong table_id)

  beforeAll(async () => {
    // Seed isolated fixtures in the universal-tables row store.
    const a = await dbGet(
      `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, '{}'::jsonb) RETURNING id`,
      [AGENTS_TABLE_ID, 'g1d-test-agentA']
    );
    const b = await dbGet(
      `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, '{}'::jsonb) RETURNING id`,
      [AGENTS_TABLE_ID, 'g1d-test-agentB']
    );
    const n = await dbGet(
      `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, '{}'::jsonb) RETURNING id`,
      [424242, 'g1d-test-not-agent']
    );
    agentA = a.id;
    agentB = b.id;
    notAgent = n.id;
  });

  afterAll(async () => {
    // ON DELETE CASCADE on agent_versions.agent_row_id cleans the versions too.
    for (const id of [agentA, agentB, notAgent]) {
      if (id) await dbRun('DELETE FROM table_rows WHERE id = ?', [id]);
    }
    await destroyAdapter();
  });

  it('#1 mint one agent → exactly one active row', async () => {
    const v1 = await mintAgentVersion({
      agentRowId: agentA,
      agentSlug: 'smith-researcher',
      prompt: 'genesis prompt',
      config: { model: 'claude-opus-4-8' },
      createdBy: 1,
    });
    expect(v1.status).toBe('active'); // genesis is live by default
    expect(v1.version_int).toBe(1);

    const active = await dbAll(
      `SELECT * FROM agent_versions WHERE agent_row_id = ? AND status = 'active'`,
      [agentA]
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(v1.id);
  });

  it('#2 promote v2 → v1 retired, v2 active, never two active', async () => {
    const v1 = await getActiveVersion(agentA);
    const v2 = await mintAgentVersion({
      agentRowId: agentA,
      agentSlug: 'smith-researcher',
      prompt: 'revised prompt',
      activate: false,
    });
    expect(v2.status).toBe('draft');
    expect(v2.version_int).toBe(2);

    const promoted = await promoteAgentVersion(v2.id);
    expect(promoted.status).toBe('active');

    const v1After = await dbGet('SELECT * FROM agent_versions WHERE id = ?', [v1.id]);
    expect(v1After.status).toBe('retired');

    const active = await dbAll(
      `SELECT * FROM agent_versions WHERE agent_row_id = ? AND status = 'active'`,
      [agentA]
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(v2.id);
  });

  it('#2b DB partial-unique index blocks a second active row', async () => {
    await expect(
      dbRun(
        `INSERT INTO agent_versions (agent_row_id, version_int, status) VALUES (?, 999, 'active')`,
        [agentA]
      )
    ).rejects.toThrow();
  });

  it('#3 FK rejects an orphan version (non-existent agent row)', async () => {
    await expect(
      dbRun(`INSERT INTO agent_versions (agent_row_id, version_int) VALUES (?, 1)`, [999999999])
    ).rejects.toThrow();
  });

  it('#3b service rejects mint for a non-existent agent (AGENT_NOT_FOUND)', async () => {
    await expect(mintAgentVersion({ agentRowId: 999999999 })).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('#3c service rejects mint against a non-agent row (NOT_AN_AGENT)', async () => {
    await expect(mintAgentVersion({ agentRowId: notAgent })).rejects.toMatchObject({
      code: 'NOT_AN_AGENT',
    });
  });

  it('retire + list + per-agent isolation', async () => {
    const b1 = await mintAgentVersion({ agentRowId: agentB, agentSlug: 'smith-builder' });
    expect(b1.status).toBe('active');
    expect(b1.version_int).toBe(1);

    const retired = await retireAgentVersion(b1.id);
    expect(retired.status).toBe('retired');
    expect(await getActiveVersion(agentB)).toBeNull();

    // agentA still has its own 2 revisions, untouched by agentB activity.
    const listA = await listAgentVersions(agentA);
    expect(listA).toHaveLength(2);
    expect(listA[0].version_int).toBe(2); // newest first
  });
});
