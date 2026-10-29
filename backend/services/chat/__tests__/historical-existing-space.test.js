// @vitest-environment node
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { importHistoricalChat, inspectHistoricalDestination, rollbackHistoricalChat } from '../historical-migration.js';
import { dbGet, withTransactionAsync as transaction } from '../../../database/connection.js';

it('imports into the chosen existing space and rollback preserves its prior data and files', async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const owner = await dbGet('SELECT id,name,email,email_verified,user_type FROM users WHERE id=$1',[17]);
  const fixture = await transaction(async trx => {
    const space = await trx.get("INSERT INTO spaces(owner_id,name,type,visibility) VALUES(17,'Existing history fixture','personal','internal') RETURNING *");
    const conversation = await trx.get("INSERT INTO conversations(title,type,created_by,space_id) VALUES('Prior conversation','chat',17,$1) RETURNING *",[space.id]);
    await trx.run("INSERT INTO files(id,name,original_name,mime_type,size,path,url,space_id,uploaded_by,visibility) VALUES($1,'Prior file','prior.txt','text/plain',0,'/tmp/prior.txt','/uploads/prior.txt',$2,17,'private')",[`prior-history-${space.id}`,space.id]);
    return {space,conversation};
  });
  const archive = {source:{domain:'crm.hltrn.cc',conversation_id:3496,db_timezone:'Europe/Moscow'},conversation:{id:3496,title:'Imported chat',created_at:'2026-10-01T12:00:00'},authors:[owner],messages:[{id:1,conversation_id:3496,sender_id:17,sender_type:'human',role:'user',content_type:'text',content:'<<@example>>',created_at:'2026-10-01T12:00:00',updated_at:null,parent_id:null,attachments:[]}]};
  const archiveText = JSON.stringify(archive);
  const input = {archiveText,digest:createHash('sha256').update(archiveText).digest('hex'),ownerId:17,expectedDatabase:'godcrm_test',expected:{messages:1,files:0,missing:0},files:[],missing:[],destination:{id:fixture.space.id,name:fixture.space.name}};
  let imported;
  try {
    await expect(inspectHistoricalDestination({...input,destination:{...input.destination,name:'Wrong name'}})).rejects.toThrow('Destination space');
    imported = await importHistoricalChat(input);
    expect(imported.space_id).toBe(fixture.space.id);
    expect((await importHistoricalChat(input)).conversation_id).toBe(imported.conversation_id);
    await rollbackHistoricalChat(input); imported = null;
    expect(await dbGet('SELECT * FROM spaces WHERE id=$1',[fixture.space.id])).toEqual(fixture.space);
    expect(await dbGet('SELECT * FROM conversations WHERE id=$1',[fixture.conversation.id])).toEqual(fixture.conversation);
    expect(await dbGet('SELECT id FROM files WHERE id=$1',[`prior-history-${fixture.space.id}`])).toBeTruthy();
  } finally {
    if (imported) await rollbackHistoricalChat(input);
    await transaction(async trx => {
      await trx.run('DELETE FROM files WHERE id=$1',[`prior-history-${fixture.space.id}`]);
      await trx.run('DELETE FROM conversations WHERE id=$1',[fixture.conversation.id]);
      await trx.run('DELETE FROM spaces WHERE id=$1',[fixture.space.id]);
    });
  }
},30000);
