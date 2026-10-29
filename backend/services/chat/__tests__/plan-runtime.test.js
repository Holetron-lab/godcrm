// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
const h = vi.hoisted(() => ({ db: null }));
vi.mock('../../../database/connection.js', () => ({
  isPostgres: () => false,
  dbGet: async (sql, args = []) => h.db.prepare(sql).get(...args),
  dbRun: async (sql, args = []) => h.db.prepare(sql).run(...args),
  withTransactionAsync: async fn => fn({
    get: async (sql, args = []) => h.db.prepare(sql).get(...args),
    run: async (sql, args = []) => h.db.prepare(sql).run(...args),
  }),
}));

import { handleManagePlan, handleMcpPlan } from '../agent-execution-shared/processing-state.js';
import { buildToolList } from '../../mcp/buildToolList.js';
const tasks = [{ id: 1, title: 'Implement', status: 'in_progress' }];
const scope = { agentId: 21, senderId: 7, runId: 'job:101' };
const rows = () => h.db.prepare('SELECT * FROM messages ORDER BY id').all();
beforeEach(() => {
  h.db?.close();
  h.db = new Database(':memory:');
  h.db.exec(`CREATE TABLE conversations (id INTEGER PRIMARY KEY, space_id INTEGER);
    INSERT INTO conversations VALUES (42, 11);
    CREATE TABLE agent_jobs (id INTEGER PRIMARY KEY, conversation_id INTEGER, agent_row_id INTEGER, agent_user_id INTEGER, agent_name TEXT, status TEXT);
    INSERT INTO agent_jobs VALUES (101,42,21,7,'Ralph','processing');
    CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, sender_id INTEGER, sender_type TEXT, role TEXT, content TEXT, content_type TEXT, agent_id INTEGER, metadata TEXT, created_at TEXT, updated_at TEXT);`);
});
describe('runtime plans', () => {
  it('advertises manage_plan over MCP', () => {
    expect(buildToolList().some(t => t.name === 'manage_plan')).toBe(true);
  });
  it('updates a run in place with correct agent and sender identity', async () => {
    await handleManagePlan({ tasks },42,'Ralph',scope);
    await handleManagePlan({ tasks: [{...tasks[0], status:'completed'}] },42,'Ralph',scope);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ agent_id:21, sender_id:7 });
    expect(JSON.parse(rows()[0].content).tasks[0].status).toBe('completed');
    expect(JSON.parse(rows()[0].metadata)).toMatchObject({ run_id:'job:101', agent_row_id:21 });
  });
  it('keeps different agents, runs, and legacy plans separate', async () => {
    h.db.prepare("INSERT INTO messages (conversation_id, content_type, content) VALUES (42,'plan','legacy')").run();
    await handleManagePlan({tasks},42,'Ralph',scope);
    await handleManagePlan({tasks},42,'Other',{...scope,agentId:22});
    await handleManagePlan({tasks},42,'Ralph',{...scope,runId:'job:102'});
    expect(rows()).toHaveLength(4);
    expect(rows()[0].content).toBe('legacy');
  });
  it('refuses unscoped persistence', async () => {
    expect(await handleManagePlan({tasks},42,'Ralph')).toHaveProperty('error');
    expect(rows()).toHaveLength(0);
  });
  it('persists MCP plans using only trusted job context, ignoring argument IDs', async () => {
    const result = await handleMcpPlan({tasks,conversation_id:999,agent_id:22}, {agentId:21,jobId:101,spaceId:11});
    expect(result).toContain('Plan updated');
    expect(rows()[0]).toMatchObject({conversation_id:42,agent_id:21,sender_id:7});
    expect(JSON.parse(rows()[0].metadata).job_db_id).toBe(101);
  });
  it.each([{},{agentId:22,jobId:101,spaceId:11},{agentId:21,jobId:101,spaceId:12}])('rejects missing or foreign MCP context %j', async context => {
    expect(await handleMcpPlan({tasks},context)).toHaveProperty('error');
    expect(rows()).toHaveLength(0);
  });
  it('rejects a completed job', async () => {
    h.db.exec("UPDATE agent_jobs SET status='completed'");
    expect(await handleMcpPlan({tasks},{agentId:21,jobId:101,spaceId:11})).toHaveProperty('error');
    expect(rows()).toHaveLength(0);
  });
  it.each([[null],[{...tasks[0], id:NaN}],[tasks[0],tasks[0]]].map(tasks => [tasks]))('rejects malformed or ambiguous tasks %j', async invalid => {
    expect(await handleManagePlan({tasks:invalid},42,'Ralph',scope)).toHaveProperty('error');
    expect(rows()).toHaveLength(0);
  });
});
