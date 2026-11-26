/**
 * Document Tool Handlers (ADR-154 + canonical per-doc model)
 *
 * Widget-bound document tools. The widget's config provides
 * registry_table_id + project_id. Each document owns its own per-doc
 * companion table (name: `doc_<slug>_<docId>`, table_type='document_content')
 * holding sections in the canonical v4 shape (level/content_<lang>/order/type).
 *
 * Mirrors the HTTP routes in backend/routes/v3/documents/{crud,content}.js
 * so MCP-created docs render identically to docs created via the UI and
 * scripts/rebuild-adr-docs-v4.js.
 */

import { dbGet, dbRun, dbAll, isPostgres } from '../../database/connection.js';
import { parseRowData } from './data-tools.js';
import { atomsToMarkdown, loadDocumentAtoms } from '../documents/renderMarkdown.js';
import { writeInitialSnapshot, writeDeletionSnapshot } from '../documents/SnapshotWriter.js';
import { collectWidgetAtomInventory } from '../documents/widgetAtomInventory.js';
import { resolveBinding } from '../documents/resolveBinding.js';
import { createCanonicalDocument } from '../documents/createDocument.js';
import { importDocumentFile, checkDocumentImport } from '../documents/import/documentImportTools.js';

export { parseMarkdownV4 } from '../documents/markdownParser.js';

// Window the rendered markdown by `offset`/`max_chars` (characters). With no
// window requested the result is returned untouched, so existing callers see
// the exact same shape. `next_offset` is null once the tail has been served.
function sliceMarkdown(result, offset, max_chars) {
  const start = Math.max(0, Number(offset) || 0);
  const cap = Number(max_chars);
  if (start === 0 && !(cap > 0)) return result;
  const total = result.markdown.length;
  const end = cap > 0 ? Math.min(total, start + cap) : total;
  return {
    ...result,
    markdown: result.markdown.slice(start, end),
    markdown_total_chars: total,
    next_offset: end < total ? end : null,
  };
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

  async get_document_content({ widget_id, document_id, format = 'full', offset = 0, max_chars }) {
    const { registry_table_id } = await resolveBinding(widget_id);

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

    // format: 'markdown' — response-size control. `atoms` duplicates the
    // rendered markdown, so a 90-atom doc came back at ~144K chars and hit the
    // MCP tool-result limit. Markdown-only skips the atom payload and the
    // widget inventory; `offset`/`max_chars` (below) page through the rest.
    if (format === 'markdown') {
      return sliceMarkdown(
        { document: { id: doc.id, ...docData }, markdown, atom_count: atoms.length, table_id: tableId },
        offset, max_chars
      );
    }

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

    return sliceMarkdown({
      document: { id: doc.id, ...docData },
      atoms,
      markdown,
      atom_count: atoms.length,
      table_id: tableId,
      research_log: Array.isArray(research_log) ? research_log : [],
      widget_atoms,
    }, offset, max_chars);
  },

  async create_document({ widget_id, title, icon = '📄', content, status = 'draft', language = 'en' }, userId) {
    const binding = await resolveBinding(widget_id);
    const { markdown, ...created } = await createCanonicalDocument({
      widget_id, title, icon, content, status, language, binding,
    }, userId);

    let sourcePath = null;
    try {
      const snapshotResult = await writeInitialSnapshot({
        widgetId: widget_id,
        documentId: created.document_id,
        markdown,
        docSlug: created.slug,
        title,
        registryTableId: created.registry_table_id,
      });
      if (snapshotResult?.written) sourcePath = snapshotResult.relative_path;
    } catch (_e) { /* already logged inside writeInitialSnapshot */ }

    return { ...created, source_path: sourcePath };
  },

  async import_document_file(args, _userId, context) {
    return importDocumentFile(args, context);
  },

  async check_document_import(args, _userId, context) {
    return checkDocumentImport(args, context);
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
