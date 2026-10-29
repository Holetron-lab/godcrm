// @vitest-environment node
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { importHistoricalChat, verifyHistoricalChat, rollbackHistoricalChat } from '../historical-migration.js';
import { dbGet, closeDatabase } from '../../../database/connection.js';

it('imports atomically into godcrm_test, preserves microseconds and replies, and retries without duplicates', async () => {
  const actual = await dbGet('SELECT current_database() AS name');
  expect(actual.name).toBe('godcrm_test');
  const owner = await dbGet('SELECT id,name,email,email_verified,user_type FROM users WHERE id = $1', [17]);
  const archive = {
    source:{domain:'crm.hltrn.cc',conversation_id:3496,db_timezone:'Europe/Moscow'},
    conversation:{id:3496,title:`test-history-${Date.now()}`,created_at:'2026-10-01T12:00:00.123456'},
    authors:[owner],messages:[1,2].map(id => ({id,conversation_id:3496,sender_id:17,sender_type:'human',role:'user',content_type:'text',content:'<<@example>>',created_at:'2026-10-01T12:00:00.123456',updated_at:null,parent_id:id === 2 ? 1 : null,attachments:'[]',is_deleted:0,is_edited:0})),
  };
  const archiveText = JSON.stringify(archive);
  const options = {archiveText,digest:createHash('sha256').update(archiveText).digest('hex'),ownerId:17,expectedDatabase:'godcrm_test',files:[],missing:[],expected:{messages:2,files:0,missing:0}};
  let imported;
  try {
    imported = await importHistoricalChat(options);
    expect(imported.conversation_id).not.toBe(3496);
    expect((await importHistoricalChat(options)).conversation_id).toBe(imported.conversation_id);
    const report = await verifyHistoricalChat(options);
    expect(report.messages).toBe(2); expect(report.verified).toBe(true);
    const reply = await dbGet('SELECT parent_id, created_at::text AS exact_time FROM messages WHERE id = $1', [report.message_map[2]]);
    expect(reply.parent_id).toBe(report.message_map[1]);
    expect(reply.exact_time).toBe('2026-10-01 12:00:00.123456');
  } finally {
    if (imported) await rollbackHistoricalChat(options);
    await closeDatabase();
  }
},30000);
