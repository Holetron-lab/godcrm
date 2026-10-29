// Fixed ClipForge data dependency import; no agents, automations or external connections.
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
const id = z.number().int().positive().safe();
const date = z.string().datetime({offset:true});
const column = z.object({
  id,table_id:id,column_name:z.string().regex(/^[a-z][a-z0-9_]*$/),display_name:z.string().nullable().optional(),
  type:z.enum(['text','number','url','date','select']),config:z.string().nullable().optional(),
  order_index:z.number().int().optional(),is_required:z.number().int().optional(),is_visible:z.number().int().optional(),width:z.number().int().nullable().optional(),
  formula:z.null().optional(),mapping:z.null().optional(),options:z.null().optional(),default_value:z.null().optional(),
}).passthrough();
const schema = z.object({
  linked_tables:z.array(z.object({id:z.union([z.literal(100371),z.literal(100372)]),name:z.string().min(1),project_id:z.literal(8432),icon:z.string().nullable().optional()}).passthrough()).length(2),
  linked_columns:z.array(column).min(1),
  linked_rows:z.array(z.object({id,table_id:id,base_id:z.string(),data:z.record(z.unknown()),created_at:date,updated_at:date}).passthrough()).min(1),
}).passthrough();

export function validateHistoricalRelated(text, digest) {
  if (createHash('sha256').update(text).digest('hex') !== digest) throw new Error('Related input digest mismatch');
  const data = schema.parse(JSON.parse(text));
  for (const records of [data.linked_tables,data.linked_columns,data.linked_rows]) if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate related identity');
  const tables = new Set(data.linked_tables.map(t => t.id));
  for (const c of data.linked_columns) {
    if (!tables.has(c.table_id)) throw new Error('Unresolved column table');
    z.object({icon:z.string().optional()}).strict().parse(JSON.parse(c.config || '{}'));
  }
  for (const t of tables) {
    const names = data.linked_columns.filter(c => c.table_id === t).map(c => c.column_name);
    if (!names.length || names.length !== new Set(names).size) throw new Error('Duplicate or empty related schema');
    for (const r of data.linked_rows.filter(r => r.table_id === t)) if (Object.keys(r.data).some(k => !names.includes(k))) throw new Error('Unknown related column');
  }
  for (const r of data.linked_rows) {
    if (!tables.has(r.table_id)) throw new Error('Unresolved row table');
    if (r.data.job_row_id != null && !data.linked_rows.some(job => job.table_id === 100371 && job.id === r.data.job_row_id)) throw new Error('Unresolved ClipForge job');
  }
  return data;
}

export async function inspectRelatedSchema(trx) {
  const required = {
    projects:'space_id name type owner_id settings is_public',
    universal_tables:'project_id name display_name icon created_by is_public config',
    table_columns:'table_id column_name display_name type config order_index is_required is_visible width',
    table_rows:'table_id base_id data created_by created_at updated_at',
  };
  const columns = await trx.all("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",[Object.keys(required)]);
  for (const [table,fields] of Object.entries(required)) {
    const actual = columns.filter(c => c.table_name === table), names = fields.split(' ');
    if (names.some(n => !actual.some(c => c.column_name === n)) || actual.some(c => c.is_nullable === 'NO' && c.column_default === null && !names.includes(c.column_name))) throw new Error(`Unsupported related schema: ${table}`);
  }
  if (!columns.some(c => c.table_name === 'table_rows' && c.column_name === 'data' && c.data_type === 'jsonb')) throw new Error('Related data must be jsonb');
  const triggers = await trx.all("SELECT tgname,pg_get_triggerdef(oid) AS definition,pg_get_functiondef(tgfoid) AS function FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('projects'::regclass,'universal_tables'::regclass,'table_columns'::regclass,'table_rows'::regclass)");
  // Reviewed registry_provenance_check returns NEW for non-document tables. Pin both bodies.
  if (triggers.some(t => t.tgname !== 'registry_provenance_trg' || createHash('sha256').update(t.definition+'\n'+t.function).digest('hex') !== '3fb87c93aad08d0260e7b6a1be8e47b3bedbf80418366381f36b99afae71d46d')) throw new Error('Review related destination triggers before importing');
}

export function projectRelatedData(data, urls, rows) {
  const rewrite = value => {
    if (typeof value === 'string') return value.replace(/(?:https?:\/\/crm\.hltrn\.cc)?\/uploads\/[^\s<>"'`)\]}]+/g, url => {
      const suffix = /[.,;]+$/.exec(url)?.[0] || '';
      const clean = suffix ? url.slice(0,-suffix.length) : url;
      return (urls.get(clean.replace(/^https?:\/\/crm\.hltrn\.cc/,'')) || clean) + suffix;
    }).replace(/<<([@/])/g,'‹‹$1');
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,rewrite(v)]));
    return value;
  };
  const result = rewrite(data);
  if (data.job_row_id != null) result.job_row_id = rows[data.job_row_id];
  return result;
}

export async function relatedState(trx, projectId) {
  const result = await trx.get(`SELECT jsonb_build_object(
    'project',(SELECT to_jsonb(p) FROM projects p WHERE id=$1),
    'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM universal_tables t WHERE project_id=$1),
    'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM table_columns c JOIN universal_tables t ON t.id=c.table_id WHERE t.project_id=$1),
    'rows',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM table_rows r JOIN universal_tables t ON t.id=r.table_id WHERE t.project_id=$1)
  ) AS state`,[projectId]);
  return createHash('sha256').update(JSON.stringify(result.state)).digest('hex');
}

export async function importRelatedData(trx, data, spaceId, ownerId, key, urls) {
  const project = await trx.get("INSERT INTO projects(space_id,name,type,owner_id,settings,is_public) VALUES($1,'ClipForge · архив','project',$2,$3,false) RETURNING id",[spaceId,ownerId,JSON.stringify({historical_import:{key,source_project_id:8432,original:data}})]);
  const report = {project_id:project.id,table_map:{},column_map:{},row_map:{},row_tables:Object.fromEntries(data.linked_rows.map(r => [r.id,r.table_id])),rows:data.linked_rows.length};
  for (const t of data.linked_tables) {
    const table = await trx.get('INSERT INTO universal_tables(project_id,name,display_name,icon,created_by,is_public,config) VALUES($1,$2,$2,$3,$4,false,$5) RETURNING id',[project.id,t.name,t.icon || null,ownerId,JSON.stringify({historical_import:{key,source_table_id:t.id}})]);
    report.table_map[t.id] = table.id;
  }
  for (const c of data.linked_columns) {
    const col = await trx.get('INSERT INTO table_columns(table_id,column_name,display_name,type,config,order_index,is_required,is_visible,width) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[report.table_map[c.table_id],c.column_name,c.display_name || c.column_name,c.type,c.config || '{}',c.order_index || 0,c.is_required || 0,c.is_visible ?? 1,c.width || null]);
    report.column_map[c.id] = col.id;
  }
  // Reserve new identities within the transaction before resolving row relations.
  for (const r of data.linked_rows) {
    const row = await trx.get('INSERT INTO table_rows(table_id,base_id,data,created_by,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5::timestamptz,$6::timestamptz) RETURNING id',[report.table_map[r.table_id],randomUUID(),'{}',ownerId,r.created_at,r.updated_at]);
    report.row_map[r.id] = row.id;
  }
  for (const r of data.linked_rows) await trx.run('UPDATE table_rows SET data=$1::jsonb WHERE id=$2',[JSON.stringify(projectRelatedData(r.data,urls,report.row_map)),report.row_map[r.id]]);
  report.state_sha256 = await relatedState(trx,project.id);
  return report;
}

export async function verifyRelatedData(trx, report) {
  await trx.all('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[report.project_id]);
  await trx.all('SELECT id FROM universal_tables WHERE project_id=$1 ORDER BY id FOR UPDATE',[report.project_id]);
  await trx.all('SELECT r.id FROM table_rows r JOIN universal_tables t ON t.id=r.table_id WHERE t.project_id=$1 ORDER BY r.id FOR UPDATE OF r',[report.project_id]);
  await trx.all('SELECT c.id FROM table_columns c JOIN universal_tables t ON t.id=c.table_id WHERE t.project_id=$1 ORDER BY c.id FOR UPDATE OF c',[report.project_id]);
  if (await relatedState(trx,report.project_id) !== report.state_sha256) throw new Error('Related data changed; review required');
  const dashboards = await trx.all('SELECT id FROM dashboards WHERE project_id=$1',[report.project_id]);
  if (dashboards.length) throw new Error('Related data changed; review required');
}

export async function rollbackRelatedData(trx, report) {
  const tables = Object.values(report.table_map);
  await trx.run('DELETE FROM table_rows WHERE table_id=ANY($1::int[])',[tables]);
  await trx.run('DELETE FROM table_columns WHERE table_id=ANY($1::int[])',[tables]);
  await trx.run('DELETE FROM universal_tables WHERE id=ANY($1::int[])',[tables]);
  await trx.run('DELETE FROM projects WHERE id=$1',[report.project_id]);
}
