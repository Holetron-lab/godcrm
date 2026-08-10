// ADR-0003 Phase 4.4 · C-11/C-12/C-13 (tickets 126813/126814/126815)
//
// Filesystem snapshot layer for documents widgets (Path C — integrated
// into documents service, NOT the generic automation engine).
//
// Writes markdown snapshots to docs/.snapshots/<widget-slug>/<doc-slug>/
// on document create, update (debounced), and delete (marker only).
// The first snapshot on create is tagged `_initial.md` and its relative
// path is written to `registry_row.data.source_path` (ADR-0003 §4.4).
//
// Gated per-widget by widget.config.snapshot_settings.enabled (default true).

import fs from 'fs/promises';
import path from 'path';
import { dbGet, dbRun, isPostgres } from '../../database/connection.js';
import { slugify } from '../../routes/v3/documents/_helpers.js';
import { parseRowData } from '../agent-tools/data-tools.js';
import { renderDocumentMarkdown } from './renderMarkdown.js';

const PROJECT_ROOT = process.cwd();
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  base_dir: 'docs/.snapshots',
  format: 'markdown',
  debounce_ms: 10000,
});

// ---------------------------------------------------------------------------
// Settings / path resolution
// ---------------------------------------------------------------------------

async function readWidgetSettings(widgetId) {
  const w = await dbGet('SELECT id, title, config FROM widgets WHERE id = ?', [widgetId]);
  if (!w) return null;
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  const settings = { ...DEFAULT_SETTINGS, ...(cfg.snapshot_settings || {}) };
  return { widget: w, cfg, settings };
}

function timestampStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildFilename(tag) {
  const stamp = timestampStamp();
  return tag ? `${stamp}_${tag}.md` : `${stamp}.md`;
}

/**
 * Resolve the snapshot folder for a document, handling collisions via
 * a `.docid` marker file. If a folder at <base>/<widget>/<slug> already
 * exists for a DIFFERENT document, we fall back to <slug>-<documentId>.
 *
 * Returns { folderAbs, folderRel, settings, widget } or { skip, reason }.
 */
async function resolveSnapshotFolder({ widgetId, documentId, docSlug }) {
  const info = await readWidgetSettings(widgetId);
  if (!info) return { skip: true, reason: `widget ${widgetId} not found` };
  const { widget, settings } = info;
  if (!settings.enabled) return { skip: true, reason: 'snapshot_settings.enabled=false' };

  const widgetSlug = slugify(widget.title || `widget-${widgetId}`) || `widget-${widgetId}`;
  const docSlugResolved = slugify(docSlug || '') || `doc-${documentId}`;
  const baseRel = path.join(settings.base_dir, widgetSlug, docSlugResolved);
  const baseAbs = path.resolve(PROJECT_ROOT, baseRel);

  // Collision check via .docid marker
  let folderRel = baseRel;
  let folderAbs = baseAbs;
  try {
    const existing = await fs.readFile(path.join(baseAbs, '.docid'), 'utf8');
    if (existing.trim() !== String(documentId)) {
      const suffixed = `${docSlugResolved}-${documentId}`;
      folderRel = path.join(settings.base_dir, widgetSlug, suffixed);
      folderAbs = path.resolve(PROJECT_ROOT, folderRel);
    }
  } catch (_) {
    // folder or .docid doesn't exist yet — good, first-time use
  }

  return { skip: false, folderAbs, folderRel, settings, widget, widgetSlug, docSlugResolved };
}

async function writeMarkerFile(folderAbs, documentId) {
  await fs.writeFile(path.join(folderAbs, '.docid'), String(documentId), { mode: 0o644 });
}

// ---------------------------------------------------------------------------
// Persist source_path back to the registry row (JSONB merge)
// ---------------------------------------------------------------------------

async function setRegistrySourcePath(registryTableId, documentId, relPath) {
  const row = await dbGet(
    'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
    [documentId, registryTableId]
  );
  if (!row) return false;
  const data = parseRowData(row.data) || {};
  data.source_path = relPath;
  const sql = isPostgres()
    ? 'UPDATE table_rows SET data = $1 WHERE id = $2 AND table_id = $3'
    : 'UPDATE table_rows SET data = ? WHERE id = ? AND table_id = ?';
  await dbRun(sql, [JSON.stringify(data), documentId, registryTableId]);
  return true;
}

// Resolve registry table id from widget config — used by hooks that don't
// already have it in scope.
async function resolveRegistryTableId(widgetId) {
  const w = await dbGet('SELECT config FROM widgets WHERE id = ?', [widgetId]);
  if (!w) return null;
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  return Number(cfg.registry_table_id || cfg.documents_table_id || 0) || null;
}

// ---------------------------------------------------------------------------
// Markdown body helpers
// ---------------------------------------------------------------------------

async function resolveMarkdown({ widgetId, documentId, markdown, title }) {
  if (typeof markdown === 'string' && markdown.trim()) return markdown;
  // Fall back to live render from companion table
  try {
    const rendered = await renderDocumentMarkdown(widgetId, documentId);
    if (rendered && rendered.markdown && rendered.markdown.trim()) return rendered.markdown;
  } catch (_) { /* ignore — we'll emit a stub */ }
  // Empty-doc stub so the file is meaningful for the backup layer
  return `# ${title || 'Untitled'}\n\n_(no content at snapshot time)_\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write the first `_initial.md` snapshot for a freshly created document
 * and store its relative path into registry_row.data.source_path.
 *
 * Failure is non-fatal: the document is already created, we just log
 * and return { written: false }. C-12 (next edit) will retry.
 */
export async function writeInitialSnapshot({
  widgetId,
  documentId,
  markdown,
  docSlug,
  title,
  registryTableId = null,
}) {
  try {
    const resolved = await resolveSnapshotFolder({ widgetId, documentId, docSlug });
    if (resolved.skip) return { written: false, skipped: true, reason: resolved.reason };

    const body = await resolveMarkdown({ widgetId, documentId, markdown, title });
    await fs.mkdir(resolved.folderAbs, { recursive: true });
    await writeMarkerFile(resolved.folderAbs, documentId);

    const filename = buildFilename('initial');
    const fileAbs = path.join(resolved.folderAbs, filename);
    const fileRel = path.join(resolved.folderRel, filename);
    await fs.writeFile(fileAbs, body, { mode: 0o644 });

    const regId = registryTableId || (await resolveRegistryTableId(widgetId));
    if (regId) {
      await setRegistrySourcePath(regId, documentId, fileRel).catch((e) => {
        console.error(`[SnapshotWriter] failed to persist source_path for doc ${documentId}:`, e.message);
      });
    }

    return { written: true, absolute_path: fileAbs, relative_path: fileRel };
  } catch (err) {
    console.error(`[SnapshotWriter] initial snapshot FAILED doc=${documentId} widget=${widgetId}:`, err.message);
    return { written: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// C-12: debounced update snapshots
// ---------------------------------------------------------------------------

/**
 * In-memory debounce map: documentId → pending timer.
 * Crash-semantic: if PM2 restarts within a debounce window, the pending
 * snapshot is lost (the document itself survives in DB). Acceptable per
 * ADR-0003 §4.4 — snapshots are a backup layer, not a ledger.
 */
const pendingTimers = new Map();

/**
 * Schedule a timestamped snapshot after a debounce window (per widget
 * settings.debounce_ms, default 10s). Multiple calls for the same
 * documentId within the window coalesce to a single write.
 */
export function scheduleUpdateSnapshot({
  widgetId,
  documentId,
  docSlug,
  title,
  registryTableId = null,
}) {
  if (!widgetId || !documentId) return { scheduled: false, reason: 'missing ids' };

  const key = `${widgetId}:${documentId}`;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing.timer);

  // Eagerly read settings once on first schedule; reuse window if pending.
  const run = async () => {
    pendingTimers.delete(key);
    try {
      await writeUpdateSnapshotNow({ widgetId, documentId, docSlug, title, registryTableId });
    } catch (err) {
      console.error(`[SnapshotWriter] debounced snapshot failed doc=${documentId}:`, err.message);
    }
  };

  readWidgetSettings(widgetId)
    .then((info) => {
      const ms = (info && info.settings.debounce_ms) || DEFAULT_SETTINGS.debounce_ms;
      const timer = setTimeout(run, ms);
      if (typeof timer.unref === 'function') timer.unref();
      pendingTimers.set(key, { timer, widgetId, documentId, docSlug, title, registryTableId });
    })
    .catch((err) => {
      console.error(`[SnapshotWriter] schedule failed doc=${documentId}:`, err.message);
    });

  return { scheduled: true };
}

/**
 * Flush any pending debounced snapshot for a document immediately. Used by
 * delete_document to ensure an up-to-date timestamped snapshot is written
 * before we record the deletion marker.
 */
export async function flushUpdateSnapshot({ widgetId, documentId }) {
  if (!widgetId || !documentId) return { flushed: false };
  const key = `${widgetId}:${documentId}`;
  const pending = pendingTimers.get(key);
  if (!pending) return { flushed: false, reason: 'no pending timer' };
  clearTimeout(pending.timer);
  pendingTimers.delete(key);
  try {
    await writeUpdateSnapshotNow({
      widgetId,
      documentId,
      docSlug: pending.docSlug,
      title: pending.title,
      registryTableId: pending.registryTableId,
    });
    return { flushed: true };
  } catch (err) {
    console.error(`[SnapshotWriter] flush failed doc=${documentId}:`, err.message);
    return { flushed: false, error: err.message };
  }
}

async function writeUpdateSnapshotNow({
  widgetId,
  documentId,
  docSlug,
  title,
  registryTableId: _registryTableId,
}) {
  const resolved = await resolveSnapshotFolder({ widgetId, documentId, docSlug });
  if (resolved.skip) return { written: false, skipped: true, reason: resolved.reason };

  const body = await resolveMarkdown({ widgetId, documentId, markdown: null, title });
  await fs.mkdir(resolved.folderAbs, { recursive: true });
  await writeMarkerFile(resolved.folderAbs, documentId);

  const filename = buildFilename(null);
  const fileAbs = path.join(resolved.folderAbs, filename);
  const fileRel = path.join(resolved.folderRel, filename);
  await fs.writeFile(fileAbs, body, { mode: 0o644 });
  return { written: true, absolute_path: fileAbs, relative_path: fileRel };
}

// ---------------------------------------------------------------------------
// Generic table-row hook — wired from tableRow*Controller.js
// ---------------------------------------------------------------------------

/**
 * Resolve (widget_id, document_id) from any table_id + row_id touched by a
 * row-mutation controller. Returns null if the table is unrelated to
 * documents.
 *
 * - If table_type = 'documents_registry' → rowId IS the document_id, and we
 *   look up the widget that references this registry table.
 * - If table_type = 'document_content'   → find the registry row whose
 *   `data.table_id` equals this content table; that row's id is the
 *   document_id, and its parent registry table tells us the widget.
 */
async function resolveDocumentContext(tableId, rowId) {
  const tbl = await dbGet(
    'SELECT id, table_type, name FROM universal_tables WHERE id = ?',
    [tableId]
  );
  if (!tbl) return null;
  const type = tbl.table_type;
  if (type !== 'documents_registry' && type !== 'document_content') return null;

  if (type === 'documents_registry') {
    const row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [rowId, tableId]
    );
    if (!row) return null;
    const data = parseRowData(row.data) || {};
    const widgetId = await findWidgetIdForRegistry(tableId);
    if (!widgetId) return null;
    return {
      widgetId,
      documentId: Number(rowId),
      docSlug: data.slug,
      title: data.name || data.title,
      registryTableId: tableId,
    };
  }

  // document_content → find parent registry row
  const parent = await dbGet(
    `SELECT tr.id AS document_id, tr.table_id AS registry_table_id, tr.data
     FROM table_rows tr
     WHERE ${isPostgres() ? `(tr.data->>'table_id')::int = ?` : `CAST(json_extract(tr.data, '$.table_id') AS INTEGER) = ?`}
     LIMIT 1`,
    [tableId]
  );
  if (!parent) return null;
  const parentData = parseRowData(parent.data) || {};
  const widgetId = await findWidgetIdForRegistry(parent.registry_table_id);
  if (!widgetId) return null;
  return {
    widgetId,
    documentId: Number(parent.document_id),
    docSlug: parentData.slug,
    title: parentData.name || parentData.title,
    registryTableId: parent.registry_table_id,
  };
}

async function findWidgetIdForRegistry(registryTableId) {
  const { dbAll } = await import('../../database/connection.js');
  const scan = await dbAll(`SELECT id, config FROM widgets`);
  const target = Number(registryTableId);
  for (const w of scan) {
    const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
    const regId = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
    if (regId === target) return w.id;
  }
  return null;
}

/**
 * Pre-capture document context for a table row before a mutation runs.
 * Callers MUST invoke this before DELETE so we can still resolve the
 * row's slug/data (it vanishes after delete).
 *
 * For create/update you can equally well call onDocumentTableMutation
 * directly — it captures internally.
 */
export async function captureDocumentContext(tableId, rowId) {
  try {
    return await resolveDocumentContext(tableId, rowId);
  } catch (err) {
    console.error('[SnapshotWriter] captureDocumentContext error:', err.message);
    return null;
  }
}

/**
 * Fire-and-forget snapshot trigger invoked by generic table row
 * controllers after any INSERT / UPDATE / DELETE. Non-blocking, errors are
 * logged but never propagated.
 *
 * If `preCaptured` is supplied (from captureDocumentContext), we skip the
 * DB lookup — important for deletes where the row is already gone.
 */
export function onDocumentTableMutation(tableId, rowId, mutationType = 'update', preCaptured = null) {
  (async () => {
    try {
      const ctx = preCaptured || (await resolveDocumentContext(tableId, rowId));
      if (!ctx) return;
      if (mutationType === 'delete') {
        const tbl = await dbGet('SELECT table_type FROM universal_tables WHERE id = ?', [tableId]);
        if (tbl?.table_type === 'documents_registry') {
          await writeDeletionSnapshot({
            widgetId: ctx.widgetId,
            documentId: ctx.documentId,
            docSlug: ctx.docSlug,
            registryTableId: ctx.registryTableId,
          });
          return;
        }
      }
      scheduleUpdateSnapshot({
        widgetId: ctx.widgetId,
        documentId: ctx.documentId,
        docSlug: ctx.docSlug,
        title: ctx.title,
        registryTableId: ctx.registryTableId,
      });
    } catch (err) {
      console.error('[SnapshotWriter] onDocumentTableMutation error:', err.message);
    }
  })();
}

// ---------------------------------------------------------------------------
// C-13: deletion marker (folder retained as archive)
// ---------------------------------------------------------------------------

/**
 * Write the final `*_deleted.md` snapshot + `_archive.json` marker when a
 * document row is deleted. The folder and all prior snapshots are
 * preserved as the FS backup per ADR-0003 §4.4.
 *
 * Order of operations:
 * 1. Flush any pending debounced update (gives us a clean
 *    `<timestamp>.md` reflecting the pre-delete state).
 * 2. Render the final markdown from the atoms (if the companion table
 *    still exists at this moment).
 * 3. Write `<timestamp>_deleted.md` with the final markdown.
 * 4. Write `_archive.json` with metadata.
 *
 * The caller is responsible for invoking this BEFORE the companion
 * content table is dropped — otherwise step 2 will produce empty
 * markdown. `markdown` can be passed explicitly to bypass the live
 * render (recommended for the delete_document path).
 */
export async function writeDeletionSnapshot({
  widgetId,
  documentId,
  docSlug,
  markdown = null,
  lastSourcePath = null,
  lastRowId = null,
  deletedBy = null,
  reason = null,
  registryTableId = null,
}) {
  try {
    await flushUpdateSnapshot({ widgetId, documentId }).catch(() => {});

    const resolved = await resolveSnapshotFolder({ widgetId, documentId, docSlug });
    if (resolved.skip) return { written: false, skipped: true, reason: resolved.reason };

    // Ensure folder exists — if not (doc was created while snapshots were
    // disabled, then re-enabled on delete) create it so the archive is
    // still captured.
    await fs.mkdir(resolved.folderAbs, { recursive: true });
    await writeMarkerFile(resolved.folderAbs, documentId);

    // Final rendered markdown — prefer explicit parameter, else try live render
    let body = markdown;
    if (typeof body !== 'string' || !body.trim()) {
      try {
        const rendered = await renderDocumentMarkdown(widgetId, documentId);
        body = (rendered && rendered.markdown) || '';
      } catch (_) { body = ''; }
    }
    if (!body || !body.trim()) {
      body = `# (deleted document ${documentId})\n\n_(no rendered content available at delete time)_\n`;
    }

    const deletedFname = buildFilename('deleted');
    const deletedAbs = path.join(resolved.folderAbs, deletedFname);
    const deletedRel = path.join(resolved.folderRel, deletedFname);
    await fs.writeFile(deletedAbs, body, { mode: 0o644 });

    const marker = {
      document_id: documentId,
      widget_id: widgetId,
      widget_slug: resolved.widgetSlug,
      doc_slug: resolved.docSlugResolved,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
      reason,
      last_source_path: lastSourcePath,
      last_row_id: lastRowId,
      last_snapshot_path: deletedRel,
      registry_table_id: registryTableId,
    };
    const markerAbs = path.join(resolved.folderAbs, '_archive.json');
    await fs.writeFile(markerAbs, JSON.stringify(marker, null, 2) + '\n', { mode: 0o644 });

    return {
      written: true,
      deleted_snapshot_path: deletedRel,
      archive_path: path.join(resolved.folderRel, '_archive.json'),
    };
  } catch (err) {
    console.error(`[SnapshotWriter] deletion snapshot failed doc=${documentId}:`, err.message);
    return { written: false, error: err.message };
  }
}

// Legacy name kept for internal hook compatibility (onDocumentTableMutation).
// Re-exports the new writeDeletionSnapshot so generic row-delete callers
// only record the archive marker (the content-table is still around at
// that point; writeDeletionSnapshot handles both).
export const writeDeletionMarker = writeDeletionSnapshot;

// ---------------------------------------------------------------------------
// C-14: published snapshot (status → published release gate)
// ---------------------------------------------------------------------------

/**
 * Write a `<doc-slug>_published.md` snapshot when a document transitions to
 * `status = published`. The canonical `_published.md` file is overwritten on
 * each publish so the latest release artifact is always at a stable path;
 * a `<timestamp>_published.md` history copy is also written alongside.
 *
 * Unlike writeInitialSnapshot, this does NOT update `source_path` — the
 * first-version pointer stays on `_initial.md` per ADR-0003 §4.4.
 *
 * Skipped when the document has no atoms (AC §6). Idempotent — safe to call
 * multiple times for the same publish event; the canonical file is simply
 * overwritten.
 */
export async function writePublishedSnapshot({
  widgetId,
  documentId,
  docSlug,
  title,
  registryTableId = null,
  markdown = null,
}) {
  try {
    // Ensure any pending debounced update is flushed first so the published
    // file reflects the latest pre-publish content.
    await flushUpdateSnapshot({ widgetId, documentId }).catch(() => {});

    const resolved = await resolveSnapshotFolder({ widgetId, documentId, docSlug });
    if (resolved.skip) return { written: false, skipped: true, reason: resolved.reason };

    // Prefer live-rendered atoms over explicit markdown when we need to
    // detect the empty-doc case (AC §6).
    let body = markdown;
    let hasAtoms = true;
    if (typeof body !== 'string' || !body.trim()) {
      try {
        const rendered = await renderDocumentMarkdown(widgetId, documentId);
        body = (rendered && rendered.markdown) || '';
        const atomCount = Array.isArray(rendered?.atoms) ? rendered.atoms.length : 0;
        if (atomCount === 0 && !body.trim()) hasAtoms = false;
      } catch (_) {
        hasAtoms = false;
        body = '';
      }
    }

    if (!hasAtoms) {
      return { written: false, skipped: true, reason: 'document has no atoms' };
    }

    if (!body || !body.trim()) {
      body = `# ${title || 'Untitled'}\n\n_(empty at publish time)_\n`;
    }

    await fs.mkdir(resolved.folderAbs, { recursive: true });
    await writeMarkerFile(resolved.folderAbs, documentId);

    // Canonical overwrite + timestamped history copy
    const canonicalFname = `${resolved.docSlugResolved}_published.md`;
    const canonicalAbs = path.join(resolved.folderAbs, canonicalFname);
    const canonicalRel = path.join(resolved.folderRel, canonicalFname);
    await fs.writeFile(canonicalAbs, body, { mode: 0o644 });

    const historyFname = buildFilename('published');
    const historyAbs = path.join(resolved.folderAbs, historyFname);
    const historyRel = path.join(resolved.folderRel, historyFname);
    await fs.writeFile(historyAbs, body, { mode: 0o644 });

    return {
      written: true,
      canonical_path: canonicalRel,
      history_path: historyRel,
    };
  } catch (err) {
    console.error(`[SnapshotWriter] published snapshot failed doc=${documentId} widget=${widgetId}:`, err.message);
    return { written: false, error: err.message };
  }
}

/**
 * Detect a `status` transition to `published` on a documents_registry row
 * and dispatch writePublishedSnapshot. Non-blocking — errors logged only.
 *
 * Called from the generic table row PUT handler after the UPDATE succeeds.
 * `oldData` and `newData` are the pre-/post-merge JSONB payloads.
 *
 * Supports multiple status key shapes (`status`, `state`) and both the
 * string form (`'published'`) and the select-id form used by some widgets
 * (the latter requires the key to be literally `'published'` after the
 * registry schema normalisation in widget 218).
 */
export function onDocumentStatusTransition(tableId, rowId, oldData, newData) {
  (async () => {
    try {
      const tbl = await dbGet(
        'SELECT id, table_type FROM universal_tables WHERE id = ?',
        [tableId]
      );
      if (!tbl || tbl.table_type !== 'documents_registry') return;

      const oldStatus = String(oldData?.status ?? oldData?.state ?? '').toLowerCase();
      const newStatus = String(newData?.status ?? newData?.state ?? '').toLowerCase();
      if (newStatus !== 'published' || oldStatus === 'published') return;

      const widgetId = await findWidgetIdForRegistry(tableId);
      if (!widgetId) return;

      await writePublishedSnapshot({
        widgetId,
        documentId: Number(rowId),
        docSlug: newData?.slug || oldData?.slug,
        title: newData?.name || newData?.title || oldData?.name || oldData?.title,
        registryTableId: tableId,
      });
    } catch (err) {
      console.error('[SnapshotWriter] onDocumentStatusTransition error:', err.message);
    }
  })();
}
