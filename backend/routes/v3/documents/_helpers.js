// Documents: shared helpers, constants, and column templates
import { dbAll, dbGet, dbRun, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../../utils/response.js';
import { getEffectiveRole, ACCESS_LEVEL_VALUES } from '../../../services/EffectiveRoleService.js';

// === ADR-105: Read-only enforcement helper ===
/**
 * Check if the current user has at least editor-level access for a project.
 * Returns true if access is allowed, false if denied.
 * If denied, sends a 403 response.
 */
export async function requireEditorAccess(req, res, projectId) {
  const userId = req.user?.id;
  if (!userId) {
    forbidden(res, 'Authentication required');
    return false;
  }
  try {
    const { effectiveRole } = await getEffectiveRole(userId, { projectId: Number(projectId) });
    const effectiveValue = ACCESS_LEVEL_VALUES[effectiveRole] ?? 0;
    const editorValue = ACCESS_LEVEL_VALUES['editor'];
    if (effectiveValue < editorValue) {
      apiLogger.warn({ userId, projectId, effectiveRole }, '[Documents] Mutation denied: insufficient access (ADR-105)');
      forbidden(res, 'Insufficient permissions. Editor access or above is required to modify documents.');
      return false;
    }
  } catch (err) {
    apiLogger.error({ err, userId, projectId }, '[Documents] Error checking effective role');
  }
  return true;
}

// === HELPER FUNCTIONS ===

/** Build structure JSON from document sections */
export function buildDocumentStructure(h2Sections, title, description = '') {
  return {
    version: 2,
    title: title || '',
    description: description || '',
    sections: h2Sections.map((section, index) => ({
      id: section.id,
      order: index + 1,
      children: (section.children || []).map(child => child.id),
      footer: null,
      collapsed: false
    })),
    footer: null,
    links: []
  };
}

// Cyrillic to Latin transliteration map
const cyrillicToLatin = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
  'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
  'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
  'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu',
  'Я': 'Ya'
};

export function transliterate(text) {
  return text.split('').map(char => cyrillicToLatin[char] || char).join('');
}

export function slugify(text) {
  return transliterate(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// === COLUMN TEMPLATES FOR DOCUMENTS v4 ===

export const REGISTRY_COLUMNS = [
  { column_name: 'name', display_name: 'Name', type: 'text', order_index: 1 },
  { column_name: 'description', display_name: 'Description', type: 'text', order_index: 2 },
  { column_name: 'slug', display_name: 'Slug', type: 'text', order_index: 3 },
  { column_name: 'table_id', display_name: 'Table ID', type: 'number', order_index: 4 },
  { column_name: 'icon', display_name: 'Icon', type: 'text', order_index: 5 },
  { column_name: 'category', display_name: 'Category', type: 'select', order_index: 6, config: { options: ['API', 'Frontend', 'Backend', 'DevOps', 'Guide', 'Other'] } },
  // Legacy text status kept during transition (frontend fallback). ADR-0001 §5.
  { column_name: 'status', display_name: 'Status (legacy)', type: 'select', order_index: 7, config: { options: ['draft', 'review', 'approved', 'ready', 'published', 'archived', 'regressed-published'] } },
  { column_name: 'order_index', display_name: 'Order', type: 'number', order_index: 8 },
  // Canonical status (relation → _doc_statuses). Resolved at creation time in createTableColumns.
  { column_name: 'status_id', display_name: 'Status', type: 'relation', order_index: 9, config: { target_table_id: null, display_column: 'label', icon: '🏷️' } },
  // Plan approval checkbox (Gate A — ADR-0003). Per-criterion verify is separate.
  { column_name: 'verified', display_name: 'Verified (Plan)', type: 'checkbox', order_index: 10, config: {} }
];

export const ATOMS_COLUMNS = [
  { column_name: 'key', display_name: 'Key', type: 'text', order_index: 1 },
  { column_name: 'title', display_name: 'Title', type: 'text', order_index: 2 },
  { column_name: 'content', display_name: 'Content', type: 'text', order_index: 3 },
  { column_name: 'type', display_name: 'Type', type: 'select', order_index: 4, config: { options: ['endpoint', 'concept', 'howto', 'code', 'reference', 'component', 'hook', 'store'] } },
  { column_name: 'http_method', display_name: 'HTTP Method', type: 'select', order_index: 5, config: { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] } },
  { column_name: 'http_path', display_name: 'HTTP Path', type: 'text', order_index: 6 },
  { column_name: 'code', display_name: 'Code', type: 'text', order_index: 7 },
  { column_name: 'tags', display_name: 'Tags', type: 'multi-select', order_index: 8, config: { options: [] } },
  { column_name: 'document_ids', display_name: 'Documents', type: 'relation', order_index: 10, config: { relation_table: null } }
];

// Per-project `_doc_statuses` seed. Keep slug list in sync with the legacy
// `status` select options in REGISTRY_COLUMNS and with any status-aware backend
// (statusResolver, releaseGate). Mirrors rows present in table 7341 (Architecture v2).
export const DOC_STATUSES_COLUMNS = [
  { column_name: 'slug', display_name: 'Slug', type: 'text', order_index: 1, config: { icon: '🔖' } },
  { column_name: 'label', display_name: 'Label', type: 'text', order_index: 2, config: { icon: '🏷️' } },
  { column_name: 'icon', display_name: 'Icon', type: 'text', order_index: 3, config: { icon: '🎨' } },
  { column_name: 'color', display_name: 'Color', type: 'text', order_index: 4, config: { icon: '🎨' } },
  { column_name: 'order', display_name: 'Order', type: 'number', order_index: 5, config: { icon: '🔢' } },
  { column_name: 'description', display_name: 'Description', type: 'text', order_index: 6, config: { icon: '📝' } },
];

export const DOC_STATUS_SEED = [
  { slug: 'draft', label: 'Draft', icon: '📝', color: 'yellow', order: 10, description: 'Черновик. В работе у автора. Не показывать вне команды.' },
  { slug: 'review', label: 'In Review', icon: '👀', color: 'purple', order: 20, description: 'На ревью/роасте. Собирает возражения.' },
  { slug: 'approved', label: 'Approved', icon: '✅', color: 'blue', order: 30, description: 'Одобрено критиками. План принят, но ещё не верифицирован хозяином.' },
  { slug: 'ready', label: 'Ready', icon: '🚀', color: 'cyan', order: 40, description: 'Готов к релизу. Все BDD-критерии зелёные.' },
  { slug: 'published', label: 'Published', icon: '🌐', color: 'green', order: 50, description: 'Опубликовано/выкачено. Действует как закон.' },
  { slug: 'regressed-published', label: 'Regressed (Published)', icon: '⚠️', color: 'orange', order: 55, description: 'Опубликованный документ регрессировал — критерии сломаны, требуется рероаст хозяина.' },
  { slug: 'archived', label: 'Archived', icon: '🗃️', color: 'gray', order: 60, description: 'Архив. Исторический интерес, силы не имеет.' },
];

export const DOCUMENT_TABLE_COLUMNS = [
  // `integer: true` enforces integer-only on the order field — frontend regression
  // had been writing fractional values (.5) which broke `ORDER BY data->>'order'::integer`.
  { column_name: 'order', display_name: 'Order', type: 'number', order_index: 1, config: { step: 10, integer: true } },
  // ADR-0003 widget-embed Phase 1: level enum realigned with UI values.
  // 'widget' is the new embed level carrying a widget_ref + settings_override.
  // 'ticket' dropped 2026-04-27: deprecated in favor of widget-embedded tickets.
  { column_name: 'level', display_name: 'Level', type: 'select', order_index: 2, config: { options: ['h1', 'h2', 'h3', 'text', 'atom', 'image', 'divider', 'page_break', 'widget'] } },
  { column_name: 'content_en', display_name: 'Content (EN)', type: 'text', order_index: 3, config: { is_default_language: true, cellFormat: { mode: 'markdown' } } },
  { column_name: 'comment', display_name: 'Comment', type: 'text', order_index: 4, config: { hidden_in_view: true } },
  { column_name: 'type', display_name: 'Type', type: 'select', order_index: 5, config: { options: ['reference', 'endpoint', 'concept', 'howto', 'code'] } },
  { column_name: 'atom_ref', display_name: 'Atom Ref', type: 'relation', order_index: 6, config: { relation_table: null } },
  // task_ref / ticket_ref dropped 2026-04-27: 0 non-empty values across 662 doc tables.
  // Use widget-embedded tickets (widget_ref) instead.
  { column_name: 'is_collapsed', display_name: 'Collapsed', type: 'boolean', order_index: 9 },
  // ADR-0003 widget-embed Phase 1: pointer to `widgets.id` for level='widget' rows.
  { column_name: 'widget_ref', display_name: 'Widget Ref', type: 'relation', order_index: 10, config: { relation_table: null, description: 'ADR-0003: embedded widget (widgets.id)' } },
  // ADR-0003 widget-embed Phase 1: JSON blob of preset-local overrides for the embedded widget (nullable).
  { column_name: 'settings_override', display_name: 'Settings Override', type: 'text', order_index: 11, config: { hidden_in_view: true, description: 'ADR-0003: JSON overrides for embedded widget' } }
];

export const LANGUAGE_NAMES = {
  en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pt: 'Português', zh: '中文', ja: '日本語', ko: '한국어',
  ar: 'العربية', he: 'עברית', uk: 'Українська', pl: 'Polski', nl: 'Nederlands',
};

/** Ensure language column exists in a table */
export async function ensureLanguageColumn(tableId, langCode) {
  if (!langCode || langCode.length < 2) return false;
  const columnName = `content_${langCode}`;
  const existing = await dbGet(
    `SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?`,
    [tableId, columnName]
  );
  if (existing) return false;
  const maxOrder = await dbGet(
    `SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?`,
    [tableId]
  );
  const nextOrder = (maxOrder?.max_order || 0) + 1;
  const langName = LANGUAGE_NAMES[langCode] || langCode.toUpperCase();
  await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
     VALUES (?, ?, ?, 'text', ?, 1, ?)`,
    [tableId, columnName, `Content (${langName})`, nextOrder, JSON.stringify({ translation: true, language: langCode, cellFormat: { mode: 'markdown' } })]
  );
  apiLogger.info(`[Documents v4] Created language column ${columnName} for table ${tableId}`);
  return true;
}

/**
 * Idempotently ensure a project has its own `_doc_statuses` reference table,
 * seeded with the canonical 7-status set. Returns { tableId, rowIds: {slug: id} }.
 * Per ADR-0001 §5 refinement: every project with a docs widget owns its own
 * editable statuses table; no cross-project sharing.
 */
export async function ensureDocStatusesForProject(projectId, userId = null) {
  if (!projectId) throw new Error('ensureDocStatusesForProject: projectId required');

  let existing = await dbGet(
    `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_doc_statuses' LIMIT 1`,
    [projectId]
  );
  let tableId;
  if (existing) {
    tableId = existing.id;
  } else {
    const baseId = generateBaseId();
    const result = await dbRun(
      `INSERT INTO universal_tables (project_id, name, display_name, icon, base_id, created_by, show_in_nav)
       VALUES (?, '_doc_statuses', 'Document Statuses', '🏷️', ?, ?, 1)`,
      [projectId, baseId, userId]
    );
    tableId = result.lastInsertRowid;
    for (const col of DOC_STATUSES_COLUMNS) {
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [tableId, col.column_name, col.display_name, col.type, col.order_index, col.config ? JSON.stringify(col.config) : null]
      );
    }
    apiLogger.info(`[Documents v4] Created _doc_statuses for project ${projectId}: table_id=${tableId}`);
  }

  const existingRows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [tableId]);
  const slugToId = {};
  for (const r of existingRows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    if (d.slug) slugToId[String(d.slug)] = r.id;
  }
  for (const seed of DOC_STATUS_SEED) {
    if (slugToId[seed.slug]) continue;
    const baseId = generateBaseId();
    const result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
      [tableId, baseId, JSON.stringify(seed), userId]
    );
    slugToId[seed.slug] = result.lastInsertRowid;
  }
  return { tableId, rowIds: slugToId };
}

/** Create columns for a table. Pass projectId when creating a registry so `status_id`
 *  resolves to that project's own `_doc_statuses` (creates one if missing). */
export async function createTableColumns(tableId, columns, atomsTableId = null, projectId = null) {
  let statusesTableId = null;
  for (const col of columns) {
    let config = col.config ? JSON.stringify(col.config) : null;
    if (col.column_name === 'atom_ref' && atomsTableId) {
      config = JSON.stringify({ ...col.config, relation_table: atomsTableId });
    }
    if (col.column_name === 'document_ids' && atomsTableId) {
      config = JSON.stringify({ ...col.config, relation_table: null });
    }
    if (col.column_name === 'status_id') {
      if (statusesTableId === null) {
        if (projectId) {
          const { tableId: dstId } = await ensureDocStatusesForProject(projectId, null);
          statusesTableId = dstId;
        } else {
          const row = await dbGet(`SELECT id FROM universal_tables WHERE name = '_doc_statuses' LIMIT 1`);
          statusesTableId = row?.id || 0;
        }
      }
      if (statusesTableId) {
        config = JSON.stringify({ ...(col.config || {}), target_table_id: statusesTableId, display_column: 'label' });
      }
    }
    await dbRun(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [tableId, col.column_name, col.display_name, col.type, col.order_index, config]
    );
  }
}

// Re-export database utilities for controllers
export { dbAll, dbGet, dbRun, isPostgres, safeJsonParse } from '../../../database/connection.js';
export { generateBaseId } from '../../../utils/baseId.js';
export { apiLogger } from '../../../utils/logger.js';
export { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../../utils/response.js';
