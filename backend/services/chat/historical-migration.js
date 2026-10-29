// Operator-only migration module. Never registered as an agent tool or a send route.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import { withTransactionAsync as withTransaction } from '../../database/connection.js';
import { apiLogger as logger } from '../../utils/logger.js';
import { validateArchive, projectHistoricalMessage } from './historical-import.js';
import { validateHistoricalRelated, inspectRelatedSchema, importRelatedData, verifyRelatedData, rollbackRelatedData } from './historical-related.js';
import { hashHistoricalFile } from './historical-files.js';

const optionsSchema = z.object({
  archiveText:z.string(), digest:z.string().regex(/^[a-f0-9]{64}$/), ownerId:z.number().int().positive(),
  relatedText:z.string().optional(),relatedDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  destination:z.object({id:z.number().int().positive(),name:z.string().min(1)}).strict().optional(),
  expectedDatabase:z.enum(['godcrm_test','godcrm_prod']),
  expected:z.object({messages:z.number().int().positive(),files:z.number().int().nonnegative(),missing:z.number().int().nonnegative()}),
  files:z.array(z.object({id:z.string(),url:z.string().startsWith('/uploads/historical-imports/'),source_url:z.string().startsWith('/uploads/'),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().nonnegative()}).passthrough()),
  missing:z.array(z.string().startsWith('/uploads/')),
});

async function preflight(trx, input) {
  const options = optionsSchema.parse(input);
  if (createHash('sha256').update(options.archiveText).digest('hex') !== options.digest) throw new Error('Archive digest mismatch');
  if (!!options.relatedText !== !!options.relatedDigest || options.relatedText && !options.destination) throw new Error('Related input requires digest and explicit destination');
  const related = options.relatedText ? validateHistoricalRelated(options.relatedText,options.relatedDigest) : null;
  const archive = validateArchive(JSON.parse(options.archiveText));
  const actual = await trx.get('SELECT current_database() AS name, host(inet_server_addr()) AS address');
  if (actual.name !== options.expectedDatabase || !['127.0.0.1','::1'].includes(actual.address)) throw new Error('Destination database mismatch');
  if (related) await inspectRelatedSchema(trx);
  // A connection to an unexpected schema fails before the first data write.
  const columns = await trx.all("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [['spaces','conversations','conversation_participants','messages','files']]);
  const insertedColumns = {
    spaces:'owner_id name type visibility access_control settings',
    conversations:'title type created_by space_id settings created_at updated_at is_processing',
    conversation_participants:'conversation_id user_id role user_type last_read_message_id',
    messages:'conversation_id sender_id sender_type role content content_type created_at updated_at attachments metadata mentions is_deleted is_edited tool_results',
    files:'id name original_name mime_type size path url space_id uploaded_by visibility metadata',
  };
  for (const [table,names] of Object.entries(insertedColumns)) {
    const supplied = names.split(' '), actualColumns = columns.filter(c => c.table_name === table);
    if (supplied.some(name => !actualColumns.some(c => c.column_name === name)) || actualColumns.some(c => c.is_nullable === 'NO' && c.column_default === null && !supplied.includes(c.column_name))) throw new Error(`Unsupported destination schema: ${table}`);
  }
  for (const [table,column,type] of [['messages','metadata','jsonb'],['messages','created_at','timestamp without time zone'],['messages','updated_at','timestamp without time zone'],['conversations','settings','text'],['spaces','type','text'],['files','visibility','text']]) {
    if (!columns.some(c => c.table_name === table && c.column_name === column && c.data_type === type)) throw new Error(`Schema mismatch: ${table}.${column}`);
  }
  const triggers = await trx.all("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('messages'::regclass,'conversations'::regclass,'files'::regclass,'spaces'::regclass,'conversation_participants'::regclass)");
  if (triggers.length) throw new Error('Review destination triggers before importing');
  const parentIndex = await trx.get(`SELECT i.indexrelid FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
    WHERE i.indrelid='public.messages'::regclass AND i.indisvalid AND i.indisready AND a.attname='parent_id'
      AND (i.indpred IS NULL OR pg_get_expr(i.indpred,i.indrelid) = '(parent_id IS NOT NULL)') LIMIT 1`);
  if (!parentIndex) throw new Error('Install scripts/historical-chat-parent-index.sql through the authorized migration channel first');
  const owner = await trx.get('SELECT id,email,email_verified,user_type FROM users WHERE id = $1', [options.ownerId]);
  const sourceOwner = archive.authors.find(a => a.email.toLowerCase() === owner?.email?.toLowerCase() && a.email_verified === 1 && a.user_type === 'human');
  if (!sourceOwner || owner.email_verified !== 1 || owner.user_type !== 'human') throw new Error('Owner identity not verified');
  if (archive.messages.length !== options.expected.messages || options.files.length !== options.expected.files || options.missing.length !== options.expected.missing) throw new Error('Count mismatch');
  if (new Set(options.files.map(f => f.id)).size !== options.files.length || new Set(options.files.map(f => f.source_url)).size !== options.files.length) throw new Error('Duplicate file map');
  if (options.destination) {
    const space = await trx.get('SELECT * FROM spaces WHERE id = $1 FOR UPDATE',[options.destination.id]);
    const grants = await trx.all('SELECT user_id FROM user_access_permissions WHERE space_id = $1',[options.destination.id]);
    if (!space || space.name !== options.destination.name || space.owner_id !== options.ownerId || space.type !== 'personal' || !['internal','private'].includes(space.visibility) || grants.length) throw new Error('Destination space identity or ACL mismatch');
  }
  return {options,archive,sourceOwner,columns,related};
}

export async function inspectHistoricalDestination(input) {
  return withTransaction(async trx => {
    const {options,columns} = await preflight(trx,input);
    return {database:options.expectedDatabase,columns};
  });
}

async function lockImport(trx,input) {
  const {options,archive,sourceOwner,columns,related} = await preflight(trx,input);
  for (const f of options.files) if (await hashHistoricalFile(f.path) !== f.sha256) throw new Error('Staged file digest mismatch');
  const key = `crm.hltrn.cc:${archive.conversation.id}:${options.digest}${options.destination ? `:space:${options.destination.id}` : ''}${options.relatedDigest ? `:data:${options.relatedDigest}` : ''}`;
  await trx.get('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const existing = await trx.get("SELECT * FROM conversations WHERE settings::jsonb->'historical_import'->>'key' = $1 FOR UPDATE", [key]);
  return {options,archive,sourceOwner,key,existing,columns,related};
}

export async function importHistoricalChat(input) {
  return withTransaction(async trx => {
    const p = await lockImport(trx,input);
    if (p.existing) return verify(trx,p);
    const {options:o,archive:a,sourceOwner,key} = p;
    const provenance = {key,source:a.source,source_conversation:a.conversation,source_participants:a.participants || [],source_authors:a.authors,digest:o.digest,expected:o.expected,missing:o.missing,owner_id:o.ownerId,destination:o.destination || null};
    const space = o.destination || await trx.get("INSERT INTO spaces(owner_id,name,type,visibility,access_control,settings) VALUES($1,$2,'personal','private',$3,$4) RETURNING id", [o.ownerId,`${a.conversation.title} · архив`,JSON.stringify({members:[]}),JSON.stringify({historical_import:provenance})]);
    const urls = new Map(o.files.map(f => [f.source_url,f.url]));
    provenance.related = p.related ? await importRelatedData(trx,p.related,space.id,o.ownerId,key,urls) : null;
    provenance.related_digest = o.relatedDigest || null;
    const conversation = await trx.get("INSERT INTO conversations(title,type,created_by,space_id,settings,created_at,updated_at,is_processing) VALUES($1,'chat',$2,$3,$4,$5::timestamp,NOW(),false) RETURNING id", [a.conversation.title,o.ownerId,space.id,JSON.stringify({historical_import:provenance}),a.conversation.created_at]);
    for (const f of o.files) {
      const ext = path.extname(f.url);
      const mime = {'.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf'}[ext] || 'application/octet-stream';
      await trx.run('INSERT INTO files(id,name,original_name,mime_type,size,path,url,space_id,uploaded_by,visibility,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'private\',$10)', [f.id,path.basename(f.path),path.basename(f.source_url),mime,f.size,f.path,f.url,space.id,o.ownerId,JSON.stringify({historical_import:{key,source_url:f.source_url,sha256:f.sha256}})]);
    }
    const messageMap = {};
    for (const m of a.messages) {
      const projection = projectHistoricalMessage(m,a.authors,urls,provenance.related);
      projection.metadata.historical_import.key = key;
      const row = await trx.get(`INSERT INTO messages(conversation_id,sender_id,sender_type,role,content,content_type,created_at,updated_at,attachments,metadata,mentions,is_deleted,is_edited,tool_results)
        VALUES($1,$2,$3,$4,$5,$6,$7::timestamp,$8::timestamp,$9,$10::jsonb,'[]',$11,$12,$13) RETURNING id`,
      [conversation.id,m.sender_id === sourceOwner.id ? o.ownerId : null,m.sender_type,m.role,projection.content,m.content_type,m.created_at,m.updated_at,JSON.stringify(projection.attachments),JSON.stringify(projection.metadata),m.is_deleted || 0,m.is_edited || 0,JSON.stringify(projection.tool_results)]);
      messageMap[m.id] = row.id;
    }
    const replyCounts = new Map();
    for (const m of a.messages.filter(m => m.parent_id !== null)) {
      await trx.run('UPDATE messages SET parent_id = $1 WHERE id = $2',[messageMap[m.parent_id],messageMap[m.id]]);
      replyCounts.set(m.parent_id,(replyCounts.get(m.parent_id) || 0) + 1);
    }
    for (const [sourceId,count] of replyCounts) await trx.run('UPDATE messages SET reply_count = $1 WHERE id = $2',[count,messageMap[sourceId]]);
    const last = a.messages.at(-1);
    await trx.run('UPDATE conversations SET messages_count = $1,last_message_id = $2,last_message_at = NOW(),last_message_preview = $3 WHERE id = $4',[a.messages.length,messageMap[last.id],'История перенесена из crm.hltrn.cc',conversation.id]);
    // Publication occurs at the same transaction commit as all messages/maps.
    await trx.run("INSERT INTO conversation_participants(conversation_id,user_id,role,user_type,last_read_message_id) VALUES($1,$2,'admin','human',$3)",[conversation.id,o.ownerId,messageMap[last.id]]);
    p.existing = {...conversation,space_id:space.id,created_by:o.ownerId,settings:JSON.stringify({historical_import:provenance})};
    const report = await verify(trx,p);
    logger.info({conversationId:conversation.id,messages:report.messages,files:report.files},'Historical chat imported without dispatch');
    return report;
  });
}

async function verify(trx, {options:o,archive:a,sourceOwner,key,existing:c}) {
  if (!c) throw new Error('Import not found');
  const provenance = JSON.parse(c.settings).historical_import;
  if ((provenance.related_digest || null) !== (o.relatedDigest || null)) throw new Error('Related digest mismatch');
  if (o.relatedText) await verifyRelatedData(trx,provenance.related);
  const space = await trx.get('SELECT * FROM spaces WHERE id = $1 FOR UPDATE',[c.space_id]);
  const participants = await trx.all('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 FOR UPDATE',[c.id]);
  const grants = await trx.all('SELECT user_id FROM user_access_permissions WHERE space_id = $1',[c.space_id]);
  if (c.created_by !== o.ownerId || space.owner_id !== o.ownerId || space.type !== 'personal' || (o.destination ? space.id !== o.destination.id || space.name !== o.destination.name || !['internal','private'].includes(space.visibility) : space.visibility !== 'private') || grants.length || participants.length !== 1 || participants[0].user_id !== o.ownerId) throw new Error('Import access changed; review required');
  const rows = await trx.all("SELECT *,to_char(created_at,'YYYY-MM-DD\"T\"HH24:MI:SS.US') AS exact_created,to_char(updated_at,'YYYY-MM-DD\"T\"HH24:MI:SS.US') AS exact_updated FROM messages WHERE conversation_id = $1 ORDER BY id FOR UPDATE",[c.id]);
  if (rows.length !== a.messages.length) throw new Error('Import messages changed; review required');
  const messageMap = Object.fromEntries(rows.map(r => [r.metadata?.historical_import?.original?.id,r.id]));
  const urls = new Map(o.files.map(f => [f.source_url,f.url]));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], m = a.messages[i], projection = projectHistoricalMessage(m,a.authors,urls,provenance.related);
    if (!isDeepStrictEqual(JSON.parse(r.tool_results),projection.tool_results)) throw new Error('Historical tool result mismatch');
    const exact = value => value && `${value.split('.')[0]}.${(value.split('.')[1] || '').padEnd(6,'0')}`;
    if (r.metadata?.historical_import?.key !== key || !isDeepStrictEqual(r.metadata.historical_import.original,m) || r.content !== projection.content || !isDeepStrictEqual(JSON.parse(r.attachments),projection.attachments) || r.exact_created !== exact(m.created_at) || r.exact_updated !== exact(m.updated_at) || r.parent_id !== (messageMap[m.parent_id] || null) || r.sender_id !== (m.sender_id === sourceOwner.id ? o.ownerId : null) || r.content_type !== m.content_type || r.role !== m.role || r.agent_id !== null || r.approval_status !== null) throw new Error(`Message verification failed: ${m.id}`);
  }
  const files = await trx.all("SELECT * FROM files WHERE space_id = $1 AND metadata::jsonb->'historical_import'->>'key' = $2 FOR UPDATE",[c.space_id,key]);
  if (files.length !== o.files.length) throw new Error('File registry count mismatch');
  for (const f of o.files) {
    const row = files.find(r => r.id === f.id);
    if (!row || row.visibility !== 'private' || row.column_id !== null || row.url !== f.url || row.path !== f.path || row.size !== f.size || JSON.parse(row.metadata).historical_import.key !== key || await hashHistoricalFile(row.path) !== f.sha256) throw new Error('File registry mismatch');
  }
  const relativeUrl = `/spaces/${c.space_id}?chat=${c.id}`;
  return {verified:true,related:provenance.related,conversation_id:c.id,space_id:c.space_id,messages:rows.length,files:files.length,missing:o.missing,message_map:messageMap,author_map:a.authors.map(author => ({source_id:author.id,name:author.name,target_id:author.id === sourceOwner.id ? o.ownerId : null})),file_map:o.files.map(f => ({source_url:f.source_url,id:f.id,url:f.url,sha256:f.sha256})),relative_url:relativeUrl,url:o.expectedDatabase === 'godcrm_prod' ? `https://app.godcrm.ai${relativeUrl}` : null};
}

export async function verifyHistoricalChat(input) {
  return withTransaction(async trx => verify(trx,await lockImport(trx,input)));
}

export async function rollbackHistoricalChat(input) {
  return withTransaction(async trx => {
    const p = await lockImport(trx,input);
    const report = await verify(trx,p); // Refuse if any user has continued/changed it.
    await trx.run('DELETE FROM conversation_participants WHERE conversation_id = $1',[report.conversation_id]);
    await trx.run('UPDATE messages SET parent_id = NULL WHERE conversation_id = $1',[report.conversation_id]);
    await trx.run('UPDATE conversations SET last_message_id = NULL WHERE id = $1',[report.conversation_id]);
    await trx.run('DELETE FROM messages WHERE conversation_id = $1',[report.conversation_id]);
    await trx.run("DELETE FROM files WHERE space_id = $1 AND metadata::jsonb->'historical_import'->>'key' = $2",[report.space_id,p.key]);
    await trx.run('DELETE FROM conversations WHERE id = $1',[report.conversation_id]);
    if (report.related) await rollbackRelatedData(trx,report.related);
    if (!p.options.destination) await trx.run('DELETE FROM spaces WHERE id = $1',[report.space_id]);
    return {rolled_back:true,private_files_retained_for_review:input.files.map(f => f.path)};
  });
}
