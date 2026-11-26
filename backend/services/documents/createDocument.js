import { dbGet, dbRun, isPostgres, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { slugify, DOCUMENT_TABLE_COLUMNS } from '../../routes/v3/documents/_helpers.js';
import { resolveStatusId } from './statusResolver.js';
import { parseMarkdownV4 } from './markdownParser.js';

async function ensureLanguageColumn(query, tableId, language) {
  if (language === 'en') return;
  const columnName = `content_${language}`;
  const existing = await query.get('SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?', [tableId, columnName]);
  if (existing) return;
  const maxOrder = await query.get('SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?', [tableId]);
  await query.run(`INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
    VALUES (?, ?, ?, 'text', ?, 1, ?)`, [
    tableId,
    columnName,
    `Content (${language === 'ru' ? 'Русский' : language.toUpperCase()})`,
    (maxOrder?.max_order || 0) + 1,
    JSON.stringify({ translation: true, language, cellFormat: { mode: 'markdown' } }),
  ]);
}

export async function createCanonicalDocument({
  widget_id,
  title,
  icon = '📄',
  content,
  status = 'draft',
  language = 'en',
  binding,
}, userId, trx = null) {
  if (!binding?.project_id) throw new Error(`Widget ${widget_id} registry has no project_id — cannot create per-doc table`);
  if (!title || typeof title !== 'string' || !title.trim()) throw new Error('title is required');
  if (!['en', 'ru'].includes(language)) throw new Error('DOCUMENT_LANGUAGE_INVALID');
  const query = trx || { get: dbGet, run: dbRun };
  const { project_id, registry_table_id, folder_path, titleCol } = binding;
  const parsed = content ? parseMarkdownV4(content) : { title: null, description: '', sections: [] };
  const slug = slugify(title);
  if (!slug) throw new Error(`title "${title}" produces empty slug — cannot create doc`);

  const slugQuery = isPostgres()
    ? `SELECT id FROM table_rows WHERE table_id = $1 AND data->>'slug' = $2`
    : `SELECT id FROM table_rows WHERE table_id = ? AND json_extract(data, '$.slug') = ?`;
  const existing = await query.get(slugQuery, [registry_table_id, slug]);
  if (existing) throw new Error(`Document with slug "${slug}" already exists in widget ${widget_id} (registry row ${existing.id})`);

  let effectiveStatus = status || 'draft';
  try {
    const statusCol = await query.get(`SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'status'`, [registry_table_id]);
    if (statusCol?.config) {
      const config = typeof statusCol.config === 'string' ? JSON.parse(statusCol.config) : statusCol.config;
      if (config?.options?.length > 0 && (!status || status === 'draft')) {
        const first = config.options[0];
        effectiveStatus = typeof first === 'string' ? first : (first?.value || 'draft');
      }
    }
  } catch { /* registry fallback remains draft */ }

  const statusIdColumn = await query.get(`SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'status_id' LIMIT 1`, [registry_table_id]);
  const statusId = statusIdColumn ? await resolveStatusId(effectiveStatus) : null;
  const initialData = {
    [titleCol]: title,
    name: title,
    description: parsed.description || '',
    slug,
    table_id: null,
    widget_id,
    icon,
    category: null,
    status: effectiveStatus,
    order_index: 0,
  };
  if (statusIdColumn) initialData.status_id = statusId;
  const regRes = await query.run(`INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
  [registry_table_id, generateBaseId(), JSON.stringify(initialData), userId || 1]);
  const documentId = regRes.lastInsertRowid;

  const tableName = `doc_${slug}_${documentId}`;
  const docTableRes = await query.run(`INSERT INTO universal_tables (project_id, name, display_name, table_type, folder_path, base_id, created_by)
    VALUES (?, ?, ?, 'document_content', ?, ?, ?)`,
  [project_id, tableName, title, folder_path, generateBaseId(), userId || 1]);
  const docTableId = docTableRes.lastInsertRowid;
  for (const column of DOCUMENT_TABLE_COLUMNS) {
    await query.run(`INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
      VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [docTableId, column.column_name, column.display_name, column.type, column.order_index, column.config ? JSON.stringify(column.config) : null]);
  }
  await ensureLanguageColumn(query, docTableId, language);

  const finalData = { ...initialData, table_id: docTableId };
  await query.run(isPostgres() ? 'UPDATE table_rows SET data = $1 WHERE id = $2' : 'UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(finalData), documentId]);

  let atomCount = 0;
  for (const section of parsed.sections) {
    const sectionData = {
      order: section.order ?? ((atomCount + 1) * 10),
      level: section.level || 'text',
      comment: '',
      type: section.type || 'reference',
      atom_ref: null,
      task_ref: null,
      ticket_ref: null,
      is_collapsed: false,
      [`content_${language}`]: section.content || '',
    };
    await query.run('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
      [docTableId, generateBaseId(), JSON.stringify(sectionData), userId || 1]);
    atomCount++;
  }

  return {
    success: true,
    document_id: documentId,
    widget_id,
    registry_table_id,
    table_id: docTableId,
    table_name: tableName,
    slug,
    atom_count: atomCount,
    markdown: content || '',
  };
}
