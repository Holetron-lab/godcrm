import { safeJsonParse, withTransactionAsync } from '../../../database/connection.js';
import { createCanonicalDocument } from '../createDocument.js';
import { resolveBinding } from '../resolveBinding.js';
import { writeInitialSnapshot } from '../SnapshotWriter.js';

function completedResponse(job) {
  return safeJsonParse(job.result_metadata, {})?.finalization || null;
}

export async function finalizeDocumentImport(job, {
  transaction = withTransactionAsync,
  createDocument = createCanonicalDocument,
  writeSnapshot = writeInitialSnapshot,
} = {}) {
  const binding = await resolveBinding(job.widget_id);
  const outcome = await transaction(async (trx) => {
    const locked = await trx.get('SELECT * FROM document_conversion_jobs WHERE id = ? FOR UPDATE', [job.id]);
    if (!locked) throw new Error('DOCUMENT_IMPORT_NOT_FOUND');
    if (locked.status === 'completed') return { response: completedResponse(locked), created: false };
    if (locked.status !== 'converted' || !locked.result_markdown) throw new Error('DOCUMENT_IMPORT_NOT_READY');

    await trx.run("UPDATE document_conversion_jobs SET status = 'finalizing', updated_at = NOW() WHERE id = ?", [locked.id]);
    const metadata = safeJsonParse(locked.result_metadata, {}) || {};
    const request = safeJsonParse(locked.import_request, {}) || {};
    const markdown = locked.result_markdown;
    const language = locked.language === 'auto' ? (/[\u0400-\u04ff]/.test(markdown) ? 'ru' : 'en') : locked.language;
    const title = request.title || metadata.title || locked.source_name || 'Imported document';
    const created = await createDocument({
      widget_id: locked.widget_id,
      title,
      icon: request.icon || '📄',
      content: markdown,
      status: request.status || 'draft',
      language,
      binding,
    }, locked.requested_by, trx);
    const response = {
      success: true,
      async: false,
      import_id: locked.id,
      status: 'completed',
      document_id: created.document_id,
      registry_table_id: created.registry_table_id,
      table_id: created.table_id,
      widget_id: locked.widget_id,
      atom_count: created.atom_count,
      source_file_url: metadata.source?.url,
      assets: metadata.assets || [],
      warnings: metadata.warnings || [],
    };
    await trx.run(`UPDATE document_conversion_jobs SET status = 'completed', document_id = ?, result_markdown = NULL,
      result_metadata = ?::jsonb, updated_at = NOW(), completed_at = NOW() WHERE id = ?`,
    [created.document_id, JSON.stringify({ ...metadata, finalization: response }), locked.id]);
    return { response, created: true, markdown, title, slug: created.slug, registryTableId: created.registry_table_id };
  });

  if (outcome.created) {
    try {
      await writeSnapshot({
        widgetId: job.widget_id,
        documentId: outcome.response.document_id,
        markdown: outcome.markdown,
        docSlug: outcome.slug,
        title: outcome.title,
        registryTableId: outcome.registryTableId,
      });
    } catch { /* snapshot recovery remains best-effort */ }
  }
  if (!outcome.response) throw new Error('DOCUMENT_IMPORT_NOT_READY');
  return outcome.response;
}
