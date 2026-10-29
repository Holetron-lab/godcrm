import { z } from 'zod';

const id = z.number().int().positive().safe();
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/);
const messageSchema = z.object({
  id, conversation_id: id, sender_id: id.nullable(), sender_type: z.enum(['human', 'agent', 'system']),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string(), content_type: z.enum(['text', 'thinking', 'tool_call', 'tool_result', 'system', 'agent_status']),
  created_at: timestamp, updated_at: timestamp.nullable(), parent_id: id.nullable(),
  attachments: z.union([z.string(), z.array(z.unknown()), z.null()]),
}).passthrough();
const archiveSchema = z.object({
  source: z.object({domain: z.literal('crm.hltrn.cc'), conversation_id: id, db_timezone: z.literal('Europe/Moscow')}).passthrough(),
  conversation: z.object({id, title: z.string().min(1), created_at: timestamp}).passthrough(),
  authors: z.array(z.object({id, name: z.string(), user_type: z.enum(['human', 'agent']), email: z.string().email(), email_verified: z.number()}).passthrough()),
  messages: z.array(messageSchema).min(1).max(100000),
}).passthrough();

export function validateArchive(input) {
  const archive = archiveSchema.parse(input);
  const ids = new Set(archive.messages.map(m => m.id));
  const authors = new Set(archive.authors.map(a => a.id));
  if (ids.size !== archive.messages.length || authors.size !== archive.authors.length) throw new Error('Duplicate source identity');
  if (archive.source.conversation_id !== archive.conversation.id) throw new Error('Conversation mismatch');
  let previous;
  for (const m of archive.messages) {
    if (m.conversation_id !== archive.conversation.id || (m.sender_id !== null && !authors.has(m.sender_id))) throw new Error('Unresolved source identity');
    if (m.parent_id !== null && !ids.has(m.parent_id)) throw new Error('Unresolved parent');
    const order = `${m.created_at.padEnd(26, '0')}/${String(m.id).padStart(16, '0')}`;
    if (previous && order <= previous) throw new Error('Source order is invalid');
    previous = order;
    z.array(z.record(z.unknown())).parse(typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments || []);
  }
  return archive;
}

// Display-only projection. The untouched source record lives in provenance;
// neither it nor the old metadata enters a dispatcher/approval/job API.
export function projectHistoricalMessage(m, authors, urls, related) {
  const author = authors.find(a => a.id === m.sender_id);
  const sourceName = author?.name || 'System';
  const rewrite = value => String(value)
    .replace(/https?:\/\/[^\s<>"'`)\]}]+|\/uploads\/[^\s<>"'`)\]}]+/g, url => {
      if (url.startsWith('http') && !/^https?:\/\/crm\.hltrn\.cc\/uploads\//.test(url)) return url;
      if (!url.includes('/uploads/')) return url;
      const path = url.replace(/^https?:\/\/crm\.hltrn\.cc/, '');
      return urls.get(path) || `https://crm.hltrn.cc${path}`;
    })
    .replace(/<<([@/])/g, '‹‹$1')
    .replace(/\[\[row:(\d+)\/(\d+)\]\]/g, (_match,table,row) => related?.table_map[table] && related?.row_tables[row] === Number(table) && related?.row_map[row] ? `[[row:${related.table_map[table]}/${related.row_map[row]}]]` : `[исходная строка crm.hltrn.cc ${table}/${row}]`)
    .replace(/([("'\s]|^)\/(projects|spaces|chat|conversations|tables|api)\//g, '$1https://crm.hltrn.cc/$2/');
  let content = `[${sourceName} · архив crm.hltrn.cc]\n${rewrite(m.content)}`;
  const attachments = [];
  for (const a of (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments || [])) {
    const ref = a.type === 'row_reference' && a.rowReference;
    if (ref && related?.table_map[ref.table_id] && related?.row_tables[ref.row_id] === Number(ref.table_id) && related?.row_map[ref.row_id]) {
      attachments.push({name:rewrite(a.name || ref.row_title || 'Запись'),size:0,type:'row_reference',rowReference:{table_id:related.table_map[ref.table_id],row_id:related.row_map[ref.row_id],row_title:rewrite(ref.row_title || a.name || 'Запись'),table_name:rewrite(ref.table_name || 'ClipForge')}});
      continue;
    }
    const path = typeof a.url === 'string' ? a.url.replace(/^https?:\/\/crm\.hltrn\.cc/, '') : null;
    if (path && urls.has(path)) {
      attachments.push({name: String(a.name || 'file'), type: ['image', 'video', 'audio', 'file'].includes(a.type) ? a.type : 'file', url: urls.get(path), size: Number(a.size) || 0});
    } else {
      content += `\n[${path?.startsWith('/uploads/') ? 'Отсутствует' : 'Исходное вложение'}: ${rewrite(a.name || a.type || 'file')}${path ? ` — ${rewrite(path)}` : ''}]`;
    }
  }
  const rewriteJson = value => typeof value === 'string' ? rewrite(value) : Array.isArray(value) ? value.map(rewriteJson) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,v]) => [key,rewriteJson(v)])) : value;
  return {
    content, attachments, created_at: m.created_at, updated_at: m.updated_at,
    tool_results: rewriteJson(typeof m.tool_results === 'string' ? JSON.parse(m.tool_results) : m.tool_results ?? null),
    // Historical names render with the existing agent-name contract; no source
    // agent/row ids are promoted to destination identities.
    metadata: {agent_name: sourceName, historical_import: {source: 'crm.hltrn.cc', original: m, author: author || null}},
  };
}
