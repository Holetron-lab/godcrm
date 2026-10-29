// @vitest-environment node
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { dbGet, dbAll, withTransactionAsync as transaction } from '../../../database/connection.js';
import { importHistoricalChat, verifyHistoricalChat, rollbackHistoricalChat } from '../historical-migration.js';

it('copies related tables with new IDs, remaps jobs, refuses changed data rollback, and preserves existing rows', async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const owner = await dbGet('SELECT id,name,email,email_verified,user_type FROM users WHERE id=17');
  const space = await transaction(trx => trx.get("INSERT INTO spaces(owner_id,name,type,visibility) VALUES(17,'Related history fixture','personal','internal') RETURNING *"));
  const date = '2026-10-01T12:00:00+03:00';
  const related = {
    linked_tables:[{id:100371,name:'Jobs',project_id:8432},{id:100372,name:'Publications',project_id:8432}],
    linked_columns:[{id:1,table_id:100371,column_name:'title',type:'text',config:'{}'},{id:2,table_id:100372,column_name:'job_row_id',type:'number',config:'{}'}],
    linked_rows:[{id:10,table_id:100371,base_id:'source-job',data:{title:'Job'},created_at:date,updated_at:date},{id:11,table_id:100372,base_id:'source-pub',data:{job_row_id:10},created_at:date,updated_at:date}],
  };
  const archiveText = JSON.stringify({source:{domain:'crm.hltrn.cc',conversation_id:3496,db_timezone:'Europe/Moscow'},conversation:{id:3496,title:'Related chat',created_at:'2026-10-01T12:00:00'},authors:[owner],messages:[{id:1,conversation_id:3496,sender_id:17,sender_type:'human',role:'user',content_type:'text',content:'[[row:100371/10]]',created_at:'2026-10-01T12:00:00',updated_at:null,parent_id:null,attachments:[]}]});
  const relatedText = JSON.stringify(related), relatedDigest = createHash('sha256').update(relatedText).digest('hex');
  const input = {archiveText,digest:createHash('sha256').update(archiveText).digest('hex'),ownerId:17,expectedDatabase:'godcrm_test',expected:{messages:1,files:0,missing:0},files:[],missing:[],destination:{id:space.id,name:space.name},relatedText,relatedDigest};
  let report;
  try {
    report = await importHistoricalChat(input);
    expect(report.related?.rows).toBe(2);
    expect(report.related.table_map[100371]).not.toBe(100371);
    const pub = await dbGet('SELECT * FROM table_rows WHERE id=$1',[report.related.row_map[11]]);
    expect(pub.data.job_row_id).toBe(report.related.row_map[10]);
    const message = await dbGet('SELECT content FROM messages WHERE id=$1',[report.message_map[1]]);
    expect(message.content).toContain(`[[row:${report.related.table_map[100371]}/${report.related.row_map[10]}]]`);
    expect((await importHistoricalChat(input)).conversation_id).toBe(report.conversation_id);
    await transaction(trx => trx.run("UPDATE table_rows SET data = '{\"title\":\"continued\"}'::jsonb WHERE id=$1",[pub.id]));
    await expect(rollbackHistoricalChat(input)).rejects.toThrow('Related data changed');
    await transaction(trx => trx.run('UPDATE table_rows SET data=$1::jsonb WHERE id=$2',[JSON.stringify(pub.data),pub.id]));
    await verifyHistoricalChat(input);
    await rollbackHistoricalChat(input); report = null;
    expect(await dbGet('SELECT id FROM spaces WHERE id=$1',[space.id])).toBeTruthy();
    expect(await dbAll('SELECT id FROM projects WHERE space_id=$1',[space.id])).toEqual([]);
  } finally {
    if (report) await rollbackHistoricalChat(input);
    await transaction(trx => trx.run('DELETE FROM spaces WHERE id=$1',[space.id]));
  }
},30000);
