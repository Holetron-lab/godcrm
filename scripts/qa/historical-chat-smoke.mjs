import '../../backend/test/setup.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { dbGet, withTransactionAsync, closeDatabase } from '../../backend/database/connection.js';
import { authenticate } from '../../backend/middleware/auth.js';
import { uploadsFileGuard } from '../../backend/middleware/fileGuard.js';
import tableRoutes from '../../backend/routes/v3/tables/index.js';
import chatRoutes from '../../backend/routes/v3/chat/index.js';
import { executeTool } from '../../backend/services/agent-tools/executor.js';
import { loadConversationHistory } from '../../backend/services/chat/agent-execution-shared/conversation-history.js';

const report = JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal((await dbGet('SELECT current_database() AS name')).name,'godcrm_test');
assert.equal(report.production_written,false);
const conversationId = report.conversation_id;
const owner = await dbGet('SELECT created_by FROM conversations WHERE id = $1',[conversationId]);
assert.equal(owner.created_by,17);
const app = express();
app.use('/api/v3/chat',authenticate,chatRoutes);
app.use('/api/v3',authenticate,tableRoutes);
app.use('/uploads',uploadsFileGuard,express.static(process.argv[3]));
const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base = `http://127.0.0.1:${server.address().port}`;
const headers = id => ({authorization:`Bearer ${jwt.sign({id,role:'user'},process.env.JWT_SECRET,{expiresIn:'5m'})}`});
const evidence = {database:'godcrm_test',conversation_id:conversationId,production_written:false};
try {
  for (const suffix of ['', '/messages','/steps']) {
    const r = await fetch(`${base}/api/v3/chat/conversations/${conversationId}${suffix}`,{headers:headers(1)});
    assert.equal(r.status,404);
  }
  let before, read = 0;
  const seen = new Set();
  do {
    const r = await fetch(`${base}/api/v3/chat/conversations/${conversationId}/messages?limit=2000${before ? `&before=${before}` : ''}`,{headers:headers(17)});
    assert.equal(r.status,200);
    const json = await r.json(), data = json.data;
    for (const m of data.messages) { assert.ok(!seen.has(m.id)); seen.add(m.id); read++; }
    before = data.hasMore ? data.nextCursor : null;
  } while (before);
  assert.equal(read,report.messages);
  evidence.http_messages = read;
  if (report.related) {
    evidence.related_tables = {};
    for (const [source,target] of Object.entries(report.related.table_map)) {
      const denied = await fetch(`${base}/api/v3/tables/${target}/rows`,{headers:headers(1)});
      assert.ok([403,404].includes(denied.status));
      const response = await fetch(`${base}/api/v3/tables/${target}/rows?limit=100`,{headers:headers(17)});
      assert.equal(response.status,200);
      const body = await response.json();
      const rows = body.data.rows;
      assert.equal(rows.length,source === '100371' ? 8 : 42);
      for (const row of rows) {
        if (row.data.job_row_id) assert.ok(Object.values(report.related.row_map).includes(row.data.job_row_id));
        if (row.data.source_clip_url) assert.ok(report.file_map.some(f => f.url === row.data.source_clip_url));
      }
      evidence.related_tables[source] = {target,rows:rows.length,outsider:'DENIED'};
    }
  }
  let checked = 0;
  for (const f of report.file_map) {
    const denied = await fetch(base+f.url,{method:'HEAD',headers:headers(1)});
    assert.equal(denied.status,403);
    const r = await fetch(base+f.url,{headers:headers(17)});
    assert.equal(r.status,200);
    const hash = createHash('sha256');
    for await (const chunk of r.body) hash.update(chunk);
    assert.equal(hash.digest('hex'),f.sha256); checked++;
  }
  evidence.http_files_sha256 = checked;
  const agent = await dbGet("SELECT id,managed_by_agent_row_id FROM users WHERE handle = 'orchestrator' AND user_type = 'agent'");
  assert.ok(agent?.managed_by_agent_row_id);
  const ctx = {agentId:agent.managed_by_agent_row_id,source:'mcp'};
  assert.ok((await executeTool('get_conversation_messages',{conversation_id:conversationId},1,ctx)).error);
  if (report.related) for (const table_id of Object.values(report.related.table_map)) assert.ok((await executeTool('query_table_data',{table_id},1,ctx)).error);
  // Temporary fixture membership exercises the trusted MCP subject, then is
  // removed in finally; source participants are never imported as members.
  await withTransactionAsync(trx => trx.run("INSERT INTO conversation_participants(conversation_id,user_id,user_type,role) VALUES($1,$2,'agent','member')",[conversationId,agent.id]));
  try {
    let cursor, count = 0;
    do {
      const page = await executeTool('get_conversation_messages',{conversation_id:conversationId,limit:1000,before_id:cursor},1,ctx);
      assert.ok(!page.error); count += page.messages.length;
      cursor = page.messages.length === 1000 ? page.messages[0].id : null;
    } while (cursor);
    assert.equal(count,report.messages);
    evidence.authorized_mcp_messages = count;
    if (report.related) for (const table_id of Object.values(report.related.table_map)) assert.ok(!(await executeTool('query_table_data',{table_id},1,ctx)).error);
  } finally {
    await withTransactionAsync(trx => trx.run('DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',[conversationId,agent.id]));
  }
  await withTransactionAsync(async trx => {
    // Run the real history loader while the committed chat still has only Joel.
    const history = await loadConversationHistory(conversationId,{max_history:200},agent.id);
    assert.ok(history.length >= 150);
    assert.ok(history.some(m => m.content.includes('архив crm.hltrn.cc')));
    evidence.agent_history_messages = history.length;
    assert.equal((await trx.get('SELECT COUNT(*)::int AS n FROM agent_jobs WHERE conversation_id = $1',[conversationId])).n,0);
  });
  evidence.unauthorized_http_and_agent = 'PASS';
  evidence.new_agent_jobs = 0;
  await writeFile(process.argv[4],JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(evidence)+'\n');
} finally {
  await new Promise(resolve => server.close(resolve));
  await closeDatabase();
}
