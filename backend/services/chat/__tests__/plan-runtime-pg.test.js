// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import pg from 'pg';
const h = vi.hoisted(() => ({ pool:null }));
vi.mock('../../../database/connection.js', () => ({
  isPostgres: () => true,
  dbGet: async (sql,args) => { let n=0; return (await h.pool.query(sql.replace(/\?/g,()=>'$'+(++n)),args)).rows[0]; },
  dbRun: vi.fn(),
  withTransactionAsync: async fn => {
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn({get:async (sql,args) => (await client.query(sql,args)).rows[0],run:(sql,args) => client.query(sql,args)});
      await client.query('COMMIT'); return value;
    } catch(err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  },
}));
import { handleManagePlan, handleMcpPlan } from '../agent-execution-shared/processing-state.js';
const schema = 'plan_runtime_' + process.pid + '_' + Date.now();
beforeAll(async () => {
  if (!process.env.POSTGRES_DB?.endsWith('_test')) throw Error('Test database required');
  h.pool = new pg.Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,options:'-c search_path='+schema,max:4});
  await h.pool.query('CREATE SCHEMA '+schema);
  await h.pool.query(`CREATE TABLE conversations (id integer primary key,space_id integer);
    INSERT INTO conversations VALUES (42,11);
    CREATE TABLE agent_jobs (id integer primary key,conversation_id integer,agent_row_id integer,agent_user_id integer,agent_name text,status text);
    INSERT INTO agent_jobs VALUES (101,42,21,7,'Ralph','processing');
    CREATE TABLE messages (id serial primary key,conversation_id integer,sender_id integer,sender_type text,role text,content text,content_type text,agent_id integer,metadata jsonb,created_at timestamptz,updated_at timestamptz);`);
});
afterAll(async () => {
  if(h.pool) { await h.pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE'); await h.pool.end(); }
});
it('serializes concurrent first writes for a run and isolates sibling agents/runs on PostgreSQL', async () => {
  const args={tasks:[{id:1,title:'Implement',status:'in_progress'}]};
  await Promise.all(Array.from({length:12},()=>handleMcpPlan(args,{agentId:21,jobId:101,spaceId:11})));
  expect((await h.pool.query('SELECT * FROM messages')).rows).toHaveLength(1);
  await Promise.all([
    handleManagePlan(args,42,'Other',{agentId:22,senderId:8,runId:'job:101'}),
    handleManagePlan(args,42,'Ralph',{agentId:21,senderId:7,runId:'job:102'}),
  ]);
  const rows=(await h.pool.query('SELECT agent_id,metadata FROM messages')).rows;
  expect(rows).toHaveLength(3);
  expect(new Set(rows.map(r=>r.agent_id+':'+r.metadata.run_id)).size).toBe(3);
});
