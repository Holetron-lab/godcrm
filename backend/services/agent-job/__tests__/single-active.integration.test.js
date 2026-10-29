import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { assertSafeTestDb } from '../../../test/setup.js';
const h = vi.hoisted(() => ({ pool: null, schema: '' }));
vi.mock('../../../database/connection.js', () => ({
  withTransactionAsync: async fn => {
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${h.schema}`);
      const tx = {
        get: async (sql, args) => (await client.query(sql, args)).rows[0],
        run: async (sql, args) => { const r = await client.query(sql, args); return { changes: r.rowCount }; },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  },
}));
const { reserveAgentJob, takeJobMessages, finishOrContinueJob } = await import('../single-active.js');
const request = { conversationId: 1, agentRowId: 21, agentUserId: 7, message: { content: 'follow-up', attachments: [{ url: '/uploads/a.png' }] } };
const create = async tx => tx.get(`INSERT INTO agent_jobs (conversation_id,agent_row_id,agent_user_id,status)
  VALUES (1,21,7,'pending') RETURNING id,job_id`);
describe.skipIf(process.env.TEST_POSTGRES !== 'true')('single active job — PostgreSQL races', () => {
  beforeAll(async () => {
    assertSafeTestDb();
    h.schema = `single_agent_${process.pid}_${Date.now()}`;
    h.pool = new pg.Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
      database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
    await h.pool.query(`CREATE SCHEMA ${h.schema}`);
    await h.pool.query(`CREATE TABLE ${h.schema}.conversations (id bigint PRIMARY KEY);
      INSERT INTO ${h.schema}.conversations VALUES (1),(2);
      CREATE TABLE ${h.schema}.agent_jobs (id bigserial PRIMARY KEY, job_id text DEFAULT 'job',
        conversation_id bigint,agent_row_id bigint,agent_user_id bigint,status text,
        context jsonb DEFAULT '{}',result_message text,result_metadata jsonb,completed_at timestamptz)`);
  });
  afterAll(async () => {
    if (h.pool) { await h.pool.query(`DROP SCHEMA IF EXISTS ${h.schema} CASCADE`); await h.pool.end(); }
  });
  beforeEach(async () => { await h.pool.query(`TRUNCATE ${h.schema}.agent_jobs RESTART IDENTITY`); });
  it('ten concurrent invocations create one job and retain nine messages', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveAgentJob(request, create)));
    expect(results.filter(r => !r.skipped)).toHaveLength(1);
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    const messages = await takeJobMessages(Number(results[0].id));
    expect(messages).toHaveLength(9);
    expect(messages[0].attachments).toEqual(request.message.attachments);
    expect(await takeJobMessages(Number(results[0].id))).toEqual([]);
  });
  it('an agent in another conversation and another agent in this chat remain independent', async () => {
    await reserveAgentJob(request, create);
    const otherChat = await reserveAgentJob({ ...request, conversationId: 2 }, async tx => tx.get(
      "INSERT INTO agent_jobs (conversation_id,agent_row_id,status) VALUES (2,21,'pending') RETURNING id"));
    const otherAgent = await reserveAgentJob({ ...request, agentRowId: 22 }, async tx => tx.get(
      "INSERT INTO agent_jobs (conversation_id,agent_row_id,status) VALUES (1,22,'pending') RETURNING id"));
    expect(otherChat.skipped).toBeUndefined(); expect(otherAgent.skipped).toBeUndefined();
  });
  it('an invocation racing completion is either queued or starts after completion', async () => {
    const first = await reserveAgentJob(request, create);
    const [pending, next] = await Promise.all([
      finishOrContinueJob(Number(first.id), 'done', {}), reserveAgentJob(request, create),
    ]);
    const { rows } = await h.pool.query(`SELECT * FROM ${h.schema}.agent_jobs WHERE status IN ('pending','processing')`);
    expect(rows).toHaveLength(1);
    if (next.skipped) expect(pending).toEqual([request.message]);
    else { expect(pending).toEqual([]); expect(next.id).not.toBe(first.id); }
  });
  it('two MCP readers deliver a queued message only once', async () => {
    const first = await reserveAgentJob(request, create);
    await reserveAgentJob(request, create);
    const messages = await Promise.all([takeJobMessages(Number(first.id)), takeJobMessages(Number(first.id))]);
    expect(messages.flat()).toEqual([request.message]);
  });
});
