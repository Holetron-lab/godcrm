import { z } from 'zod';
import { documentConversionService } from './instance.js';
import { readConversationAttachment, resolveDocumentImportScope, requireDocumentEditor, assertJobScope } from './attachmentScope.js';
import { resolveBinding } from '../resolveBinding.js';
import { finalizeDocumentImport } from './finalizeDocumentImport.js';

const importSchema = z.object({
  widget_id: z.number().int().positive(),
  file_url: z.string().max(1000),
  title: z.string().trim().min(1).max(500).optional(),
  icon: z.string().max(32).default('📄'),
  status: z.enum(['draft', 'review', 'approved', 'ready', 'published', 'archived']).default('draft'),
  language: z.enum(['auto', 'en', 'ru']).default('auto'),
}).strict();
const checkSchema = z.object({ import_id: z.string().uuid() }).strict();

function importError(error) {
  const message = error instanceof z.ZodError ? 'DOCUMENT_IMPORT_INVALID_INPUT' : error?.message;
  return { error: /^[A-Z][A-Z0-9_]{2,80}$/.test(message || '') ? message : 'DOCUMENT_IMPORT_FAILED' };
}

export async function importDocumentFile(args, context) {
  try {
    const input = importSchema.parse(args);
    const scope = await resolveDocumentImportScope(context);
    const binding = await resolveBinding(input.widget_id);
    await requireDocumentEditor(scope.userId, binding.project_id);
    const attachment = await readConversationAttachment(input.file_url, scope);
    const job = await documentConversionService.createJob({
      bytes: attachment.bytes,
      name: attachment.name,
      widgetId: input.widget_id,
      language: input.language,
      requestedBy: scope.userId,
      conversationId: scope.conversationId,
      importRequest: { title: input.title, icon: input.icon, status: input.status },
    });
    documentConversionService.schedule(job.id);
    return {
      success: true,
      async: true,
      import_id: job.id,
      status: 'queued',
      message: 'Poll with check_document_import; do not resubmit the same file.',
    };
  } catch (error) {
    return importError(error);
  }
}

export async function checkDocumentImport(args, context) {
  try {
    const input = checkSchema.parse(args);
    const scope = await resolveDocumentImportScope(context);
    const job = await documentConversionService.getJob(input.import_id);
    await assertJobScope(job, scope);
    await requireDocumentEditor(scope.userId, job.project_id);
    if (['queued', 'processing'].includes(job.status)) {
      documentConversionService.schedule(job.id);
      return { success: true, async: true, import_id: job.id, status: job.status };
    }
    if (['converted', 'completed'].includes(job.status)) return finalizeDocumentImport(job);
    if (job.status === 'finalizing') return { success: true, async: true, import_id: job.id, status: job.status };
    return { success: false, async: false, import_id: job.id, status: job.status, error: job.error_code || 'DOCUMENT_IMPORT_FAILED' };
  } catch (error) {
    return importError(error);
  }
}
