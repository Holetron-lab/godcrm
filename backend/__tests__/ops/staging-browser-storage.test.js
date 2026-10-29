// @vitest-environment node
import '../../test/setup.js';
import crypto from 'node:crypto';
import { it, expect } from 'vitest';
import { dbGet, withTransactionAsync } from '../../database/connection.js';
import { up } from '../../database/migrations/knex/100_ops_staging_browser.js';

it('persists registration and enforces per-job exclusion in PostgreSQL, then rolls back all fixtures', async () => {
  const actual = await dbGet('SELECT current_database() AS name');
  expect(actual.name).toBe('godcrm_test');
  await dbGet(`SELECT j.id FROM agent_jobs j JOIN conversations c ON c.id = j.conversation_id WHERE false AND c.space_id = 11 AND j.status = 'running'`);
  const schema = `browser_test_${crypto.randomBytes(8).toString('hex')}`;
  const rollback = new Error('fixture rollback');
  await expect(withTransactionAsync(async trx => {
    await trx.run(`CREATE SCHEMA ${schema}`);
    await trx.run(`SET LOCAL search_path TO ${schema}`);
    await up({ raw: sql => trx.run(sql) });
    const columns = await trx.all(`SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`, [schema, 'ops_browser_grants']);
    expect(columns.map(c => c.column_name)).toContain('pins');
    const grant = await trx.get(`INSERT INTO ops_browser_grants
      (job_id, agent_id, space_id, role, repo, candidate_sha, suite_ids, pins, issued_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, now() + interval '1 minute') RETURNING *`,
    ['1', 1, 11, 'frontend-qa', '/root/wt-fixture', 'a'.repeat(40), '["axe-v1"]', '{}', 1]);
    expect(grant.deadline_seconds).toBe(180);
    const id = crypto.randomUUID();
    const insert = `INSERT INTO ops_browser_runs (id, worker_id, grant_id, job_id, suite_id, candidate_sha, pins, status, deadline_at)
      VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'registered', now() + interval '1 minute')`;
    await trx.run(insert, [id, `godcrm-browser-${id}`, grant.id, '1', 'axe-v1', grant.candidate_sha, '{}']);
    expect(await trx.get('SELECT worker_id FROM ops_browser_runs WHERE id = ?', [id])).toEqual({ worker_id: `godcrm-browser-${id}` });
    await trx.run('SAVEPOINT collision');
    const next = crypto.randomUUID();
    await expect(trx.run(insert, [next, `godcrm-browser-${next}`, grant.id, '1', 'axe-v1', grant.candidate_sha, '{}'])).rejects.toMatchObject({ code: '23505' });
    await trx.run('ROLLBACK TO SAVEPOINT collision');
    await trx.run(`UPDATE ops_browser_runs SET status = 'finished' WHERE id = ?`, [id]);
    await trx.run(insert, [next, `godcrm-browser-${next}`, grant.id, '1', 'axe-v1', grant.candidate_sha, '{}']);
    expect(await trx.get('SELECT count(*)::int AS n FROM ops_browser_runs')).toEqual({ n: 2 });
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await dbGet('SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?', [schema])).toBeFalsy();
});
