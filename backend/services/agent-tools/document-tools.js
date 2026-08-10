/**
 * Document Tool Handlers (ADR-154 + canonical per-doc model)
 *
 * Widget-bound document tools. The widget's config provides
 * registry_table_id + project_id. Each document owns its own per-doc
 * companion table (name: `doc_<slug>_<docId>`, table_type='document_content')
 * holding sections in the canonical v4 shape (level/content_en/order/type).
 *
 * Mirrors the HTTP routes in backend/routes/v3/documents/{crud,content}.js
 * so MCP-created docs render identically to docs created via the UI and
 * scripts/rebuild-adr-docs-v4.js.
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow } from '../../database/connection.js';
import { parseRowData } from './data-tools.js';
import { generateBaseId } from '../../utils/baseId.js';
import {
  slugify,
  DOCUMENT_TABLE_COLUMNS,
  createTableColumns,
} from '../../routes/v3/documents/_helpers.js';
import { atomsToMarkdown, loadDocumentAtoms } from '../documents/renderMarkdown.js';
import { writeInitialSnapshot, writeDeletionSnapshot } from '../documents/SnapshotWriter.js';
import { resolveStatusId, hasStatusIdColumn } from '../documents/statusResolver.js';
import { collectWidgetAtomInventory } from '../documents/widgetAtomInventory.js';

// ---------------------------------------------------------------------------
// Markdown → v4 sections parser
// Mirrors scripts/rebuild-adr-docs-v4.js::parseMarkdownV4 and the frontend
// src/features/widgets/utils/parseMarkdownToAtoms.ts::parseMarkdownToDocumentV4.
// Sections land in the per-doc table with level in {h1,h2,h3,text,divider}.
// ---------------------------------------------------------------------------
function toDocumentLevel(n) {
  return n === 1 ? 'h1' : n === 2 ? 'h2' : n === 3 ? 'h3' : 'text';
}

function detectType(title, content) {
  const tl = (title || '').toLowerCase();
  const cl = (content || '').toLowerCase();
  if (/^(GET|POST|PUT|PATCH|DELETE)\s+/i.test(title || '')) return 'endpoint';
  if (tl.includes('component') || /<[A-Z][a-zA-Z]+/.test(content)) return 'component';
  if (tl.startsWith('use') || /use[A-Z]\w+/.test(content)) return 'hook';
  if (tl.includes('store') || cl.includes('zustand')) return 'store';
  if (tl.includes('how') || tl.includes('guide') || tl.includes('tutorial')) return 'howto';
  if (content.match(/```[\s\S]+```/) && content.split('```').length > 4) return 'code';
  if (content.length > 500) return 'concept';
  return 'reference';
}

export function parseMarkdownV4(markdown) {
  const content = (markdown || '').replace(/\r\n/g, '\n').trim();
  const lines = content.split('\n');

  const h1Match = content.match(/^#\s+(.+)$/m);
  const documentTitle = h1Match ? h1Match[1].trim() : 'Untitled';

  let description = '';
  const h1Idx = content.indexOf('# ');
  const h2Idx = content.indexOf('\n## ');
  if (h1Idx !== -1 && h2Idx !== -1 && h2Idx > h1Idx) {
    description = content.substring(content.indexOf('\n', h1Idx) + 1, h2Idx)
      .trim().split('\n').slice(0, 3).join(' ').trim();
  }

  const sections = [];
  let currentTitle = '';
  let currentLevel = 'text';
  let currentContent = [];
  let inSection = false;
  let orderIndex = 0;
  let skippedFirstH1 = false;

  const finalize = () => {
    if (!inSection) return;
    const trimmed = currentContent.join('\n').trim();

    if (currentLevel === 'h1' && !skippedFirstH1) {
      skippedFirstH1 = true;
      currentTitle = ''; currentContent = []; inSection = false;
      return;
    }

    if (currentLevel === 'h2' || currentLevel === 'h3') {
      if (currentTitle) {
        orderIndex += 10;
        sections.push({
          order: orderIndex,
          level: currentLevel,
          content: currentTitle,
          type: detectType(currentTitle, trimmed),
        });
      }
      if (trimmed) {
        orderIndex += 10;
        sections.push({ order: orderIndex, level: 'text', content: trimmed, type: 'reference' });
      }
    } else if (currentTitle || trimmed) {
      orderIndex += 10;
      sections.push({
        order: orderIndex,
        level: currentLevel,
        content: currentTitle || trimmed,
        type: detectType(currentTitle, trimmed),
      });
    }

    currentTitle = ''; currentContent = []; inSection = false;
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      finalize();
      currentLevel = toDocumentLevel(headerMatch[1].length);
      currentTitle = headerMatch[2].trim();
      inSection = true;
    } else if (line.startsWith('---') && line.replace(/-/g, '').trim() === '') {
      if (inSection) finalize();
      orderIndex += 10;
      sections.push({ order: orderIndex, level: 'divider', content: '' });
    } else {
      if (!inSection && line.trim()) {
        inSection = true; currentLevel = 'text'; currentTitle = '';
      }
      if (inSection) currentContent.push(line);
    }
  }
  finalize();

  return { title: documentTitle, description, sections };
}

// Validate JSON-column identifier so it can be safely inlined into SQL.
// Identifiers cannot be bound as parameters; widget config is user-editable.
function safeIdent(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid column identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

async function resolveBinding(widget_id) {
  if (widget_id === undefined || widget_id === null) {
    throw new Error('widget_id is required (ADR-154: document tools are widget-bound)');
  }

  const w = await dbGet('SELECT id, config FROM widgets WHERE id = ?', [widget_id]);
  if (!w) throw new Error(`Widget ${widget_id} not found`);

  const cfg = typeof w.config === 'string' ? JSON.parse(w.config) : (w.config || {});
  const registry_table_id = Number(cfg.registry_table_id || cfg.documents_table_id);
  if (!registry_table_id) {
    throw new Error(`Widget ${widget_id} is not a documents widget (missing registry_table_id)`);
  }

  let project_id = cfg.project_id ? Number(cfg.project_id) : null;
  let folder_path = null;
  const tbl = await dbGet(
    'SELECT project_id, folder_path FROM universal_tables WHERE id = ?',
    [registry_table_id]
  );
  if (!project_id) project_id = tbl?.project_id || null;
  folder_path = tbl?.folder_path || 'databases/documents/';

  const titleCol = safeIdent(cfg.documents_titleColumn || 'name');

  return { project_id, registry_table_id, folder_path, titleCol };
}

export const documentToolHandlers = {
  async list_documents({ widget_id, search, limit = 50, include_archived = false }) {
    const { registry_table_id, titleCol } = await resolveBinding(widget_id);

    const pg = isPostgres();
    let paramIdx = 1;
    let whereClause = pg
      ? `WHERE table_id = $${paramIdx++}`
      : 'WHERE table_id = ?';
    const params = [registry_table_id];

    if (search) {
      if (pg) whereClause += ` AND data->>'${titleCol}' ILIKE $${paramIdx++}`;
      else whereClause += ` AND json_extract(data, '$.${titleCol}') LIKE ?`;
      params.push(`%${search}%`);
    }

    if (!include_archived) {
      whereClause += pg
        ? ` AND (data->>'status' IS DISTINCT FROM 'archived')`
        : ` AND json_extract(data, '$.status') IS NOT 'archived'`;
    }

    const countResult = await dbGet(
      `SELECT COUNT(*) as cnt FROM table_rows ${whereClause}`, params
    );
    const total = parseInt(countResult?.cnt || '0', 10);

    let query = `SELECT id, data, created_at FROM table_rows ${whereClause} ORDER BY created_at DESC`;
    const limitParams = [...params];
    query += pg ? ` LIMIT $${paramIdx++}` : ' LIMIT ?';
    limitParams.push(limit);

    const rows = await dbAll(query, limitParams);
    const documents = rows.map(r => {
      const data = parseRowData(r.data);
      return {
        id: r.id,
        title: data[titleCol] || data.name || data.title,
        slug: data.slug,
        icon: data.icon,
        status: data.status,
        order: data.order_index ?? data.order,
        table_id: data.table_id,
        created_at: r.created_at,
      };
    });

    return { documents, total, widget_id, registry_table_id };
  },

  async get_document_content({ widget_id, document_id }) {
    const { registry_table_id, titleCol } = await resolveBinding(widget_id);

    const doc = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [document_id, registry_table_id]
    );
    if (!doc) return { error: `Document ${document_id} not found in widget ${widget_id}` };

    const docData = parseRowData(doc.data);
    const tableId = docData.table_id;

    if (!tableId) {
      return {
        document: { id: doc.id, ...docData },
        atoms: [],
        markdown: '',
        atom_count: 0,
        widget_atoms: [],
        warning: 'Document has no companion content table (legacy registry row created before the canonical per-doc model). Use scripts/rebuild-adr-docs-v4.js to republish with sections.',
      };
    }

    // Atom loading + markdown rendering live in a shared helper so C-11/C-12
    // snapshot automation can reuse the exact same code path.
    const atoms = await loadDocumentAtoms(tableId);
    const markdown = atomsToMarkdown(atoms);

    // ADR-0005 §C-13 — flat inventory of every embedded widget-atom in this
    // document. Lossless: deleted target widgets/docs still appear with
    // `missing: true`. Failures are non-fatal so a broken inventory never
    // breaks document reads.
    let widget_atoms = [];
    try {
      widget_atoms = await collectWidgetAtomInventory(atoms);
    } catch (_) { widget_atoms = []; }

    // ADR-0003 C-6: surface express_research_log as a read-only `research_log`
    // mirror so MCP callers can see the architect's Phase-0 log without
    // a second endpoint hit.
    const rawLog = docData.express_research_log;
    const research_log = Array.isArray(rawLog)
      ? rawLog
      : (typeof rawLog === 'string' ? (parseRowData(rawLog) || []) : []);

    return {
      document: { id: doc.id, ...docData },
      atoms,
      markdown,
      atom_count: atoms.length,
      table_id: tableId,
      research_log: Array.isArray(research_log) ? research_log : [],
      widget_atoms,
    };
  },

  async create_document({ widget_id, title, icon = '📄', content, status = 'draft' }, userId) {
    const { project_id, registry_table_id, folder_path, titleCol } = await resolveBinding(widget_id);
    if (!project_id) {
      throw new Error(`Widget ${widget_id} registry has no project_id — cannot create per-doc table`);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new Error('title is required');
    }

    const parsed = content ? parseMarkdownV4(content) : { title: null, description: '', sections: [] };

    const slug = slugify(title);
    if (!slug) throw new Error(`title "${title}" produces empty slug — cannot create doc`);

    // Slug uniqueness within this registry
    const pg = isPostgres();
    const slugQuery = pg
      ? `SELECT id FROM table_rows WHERE table_id = $1 AND data->>'slug' = $2`
      : `SELECT id FROM table_rows WHERE table_id = ? AND json_extract(data, '$.slug') = ?`;
    const existing = await dbGet(slugQuery, [registry_table_id, slug]);
    if (existing) {
      throw new Error(`Document with slug "${slug}" already exists in widget ${widget_id} (registry row ${existing.id})`);
    }

    // Resolve default status from registry column config (match crud.js behavior)
    let effectiveStatus = status || 'draft';
    try {
      const statusCol = await dbGet(
        `SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'status'`,
        [registry_table_id]
      );
      if (statusCol?.config) {
        const pcfg = typeof statusCol.config === 'string' ? JSON.parse(statusCol.config) : statusCol.config;
        if (pcfg?.options?.length > 0 && (!status || status === 'draft')) {
          const firstOpt = pcfg.options[0];
          effectiveStatus = typeof firstOpt === 'string' ? firstOpt : (firstOpt?.value || 'draft');
        }
      }
    } catch (_) { /* fallback to 'draft' */ }

    // Resolve canonical status_id via _doc_statuses relation (ADR-0001 §5).
    // Legacy text `status` kept in sync during transition.
    const statusIdColumnExists = await hasStatusIdColumn(registry_table_id);
    const statusId = statusIdColumnExists ? await resolveStatusId(effectiveStatus) : null;

    // Insert registry row with table_id=null (filled after per-doc table creation)
    const initialData = {
      [titleCol]: title,
      name: title,
      description: parsed.description || '',
      slug,
      table_id: null,
      icon,
      category: null,
      status: effectiveStatus,
      order_index: 0,
    };
    if (statusIdColumnExists) initialData.status_id = statusId;
    const regBase = generateBaseId();
    const regRes = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [registry_table_id, regBase, JSON.stringify(initialData), userId || 1]);
    const documentId = regRes.lastInsertRowid;

    // Create per-doc companion table
    const tableName = `doc_${slug}_${documentId}`;
    const docTableBaseId = generateBaseId();
    const docTableRes = await dbRun(`
      INSERT INTO universal_tables (project_id, name, display_name, table_type, folder_path, base_id, created_by)
      VALUES (?, ?, ?, 'document_content', ?, ?, ?)
    `, [project_id, tableName, title, folder_path, docTableBaseId, userId || 1]);
    const docTableId = docTableRes.lastInsertRowid;

    // Provision canonical v4 content columns
    await createTableColumns(docTableId, DOCUMENT_TABLE_COLUMNS);

    // Patch registry row with the fresh table_id
    const regDataFinal = { ...initialData, table_id: docTableId };
    const updSql = pg
      ? `UPDATE table_rows SET data = $1 WHERE id = $2`
      : `UPDATE table_rows SET data = ? WHERE id = ?`;
    await dbRun(updSql, [JSON.stringify(regDataFinal), documentId]);

    // Insert parsed sections (if any) into per-doc table
    let sectionCount = 0;
    let orderIndex = 10;
    for (const section of parsed.sections) {
      const baseId = generateBaseId();
      const sectionData = {
        order: section.order ?? orderIndex,
        level: section.level || 'text',
        comment: '',
        type: section.type || 'reference',
        atom_ref: null,
        task_ref: null,
        ticket_ref: null,
        is_collapsed: false,
        content_en: section.content || '',
      };
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [docTableId, baseId, JSON.stringify(sectionData), userId || 1]
      );
      orderIndex += 10;
      sectionCount++;
    }

    // ADR-0003 C-11: FS snapshot (*_initial.md) + source_path on registry row.
    // Non-fatal — if it fails, doc creation still succeeds (C-12 will retry
    // on the next edit).
    let sourcePath = null;
    let snapshotResult = null;
    try {
      snapshotResult = await writeInitialSnapshot({
        widgetId: widget_id,
        documentId,
        markdown: content || '',
        docSlug: slug,
        title,
        registryTableId: registry_table_id,
      });
      if (snapshotResult?.written) sourcePath = snapshotResult.relative_path;
    } catch (_e) { /* already logged inside writeInitialSnapshot */ }

    return {
      success: true,
      document_id: documentId,
      widget_id,
      registry_table_id,
      table_id: docTableId,
      table_name: tableName,
      slug,
      atom_count: sectionCount,
      source_path: sourcePath,
    };
  },

  async delete_document({ widget_id, document_id, reason = null }, userId) {
    const { registry_table_id, titleCol } = await resolveBinding(widget_id);

    const doc = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [document_id, registry_table_id]
    );
    if (!doc) return { error: `Document ${document_id} not found in widget ${widget_id}` };

    const docData = parseRowData(doc.data);
    const docTableId = docData.table_id;
    const docTitle = docData[titleCol] || docData.name || '(untitled)';

    // ADR-0003 C-13: capture final markdown BEFORE we drop the companion
    // content table (after drop we can't render it anymore).
    let finalMarkdown = '';
    if (docTableId) {
      try {
        const atoms = await loadDocumentAtoms(docTableId);
        finalMarkdown = atomsToMarkdown(atoms);
      } catch (_) { /* best-effort */ }
    }

    let atomsDeleted = 0;
    if (docTableId) {
      const delRes = await dbRun(`DELETE FROM table_rows WHERE table_id = ?`, [docTableId]);
      atomsDeleted = (delRes && (delRes.changes ?? delRes.rowCount ?? delRes.affectedRows)) || 0;
      await dbRun(`DELETE FROM table_columns WHERE table_id = ?`, [docTableId]);
      await dbRun(`DELETE FROM universal_tables WHERE id = ?`, [docTableId]);
    }

    await dbRun(
      'DELETE FROM table_rows WHERE id = ? AND table_id = ?',
      [document_id, registry_table_id]
    );

    // ADR-0003 C-13: write *_deleted.md + _archive.json into the snapshot
    // folder. Non-fatal — delete is already committed.
    let archiveInfo = null;
    try {
      archiveInfo = await writeDeletionSnapshot({
        widgetId: widget_id,
        documentId: document_id,
        docSlug: docData.slug,
        markdown: finalMarkdown,
        lastSourcePath: docData.source_path || null,
        lastRowId: document_id,
        deletedBy: userId || null,
        reason,
        registryTableId: registry_table_id,
      });
    } catch (_e) { /* logged inside writeDeletionSnapshot */ }

    return {
      success: true,
      message: `Document "${docTitle}" deleted (${atomsDeleted} sections, companion table ${docTableId ? 'dropped' : 'absent'})`,
      atoms_deleted: atomsDeleted,
      table_id: docTableId || null,
      archive: archiveInfo?.written ? {
        deleted_snapshot_path: archiveInfo.deleted_snapshot_path,
        archive_path: archiveInfo.archive_path,
      } : null,
    };
  },
};
