// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const hash = vi.hoisted(() => vi.fn(async () => 'a'.repeat(64)));
vi.mock('../historical-files.js', () => ({hashHistoricalFile:hash}));
import { importHistoricalChat, rollbackHistoricalChat } from '../historical-migration.js';
import { dbGet, withTransactionAsync as transaction } from '../../../database/connection.js';

it('prevents a concurrent message edit from slipping between rollback verification and deletion', async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const owner = await dbGet('SELECT id,name,email,email_verified,user_type FROM users WHERE id=17');
  const archiveText = JSON.stringify({source:{domain:'crm.hltrn.cc',conversation_id:3496,db_timezone:'Europe/Moscow'},conversation:{id:3496,title:`Rollback race ${Date.now()}`,created_at:'2026-10-01T12:00:00'},authors:[owner],messages:[{id:1,conversation_id:3496,sender_id:17,sender_type:'human',role:'user',content_type:'text',content:'original',created_at:'2026-10-01T12:00:00',updated_at:null,parent_id:null,attachments:[]}]});
  const input = {archiveText,digest:createHash('sha256').update(archiveText).digest('hex'),ownerId:17,expectedDatabase:'godcrm_test',expected:{messages:1,files:1,missing:0},missing:[],files:[{id:`race-${Date.now()}`,url:'/uploads/historical-imports/race/file.txt',source_url:'/uploads/file.txt',path:'/test-seam/file.txt',sha256:'a'.repeat(64),size:0}]};
  const report = await importHistoricalChat(input);
  let release, reached;
  const paused = new Promise(resolve => {reached=resolve;});
  const resume = new Promise(resolve => {release=resolve;});
  hash.mockResolvedValueOnce('a'.repeat(64)).mockImplementationOnce(async () => {reached();await resume;return 'a'.repeat(64);});
  const rollback = rollbackHistoricalChat(input);
  let writeError;
  try {
    await paused;
    try {
      await transaction(async trx => {
        await trx.run("SET LOCAL lock_timeout = '100ms'");
        await trx.run('UPDATE messages SET content=$1 WHERE id=$2',['concurrent edit',report.message_map[1]]);
      });
    } catch (error) {writeError=error;}
  } finally {release();await rollback;}
  expect(writeError?.code).toBe('55P03');
},30000);
