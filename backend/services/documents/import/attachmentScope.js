import { z } from 'zod';
import { dbGet } from '../../../database/connection.js';
import { getEffectiveRole, ACCESS_LEVEL_VALUES } from '../../EffectiveRoleService.js';
import { readLocalFile } from './fileStorage.js';
import { SOURCE_LIMIT } from './sourceValidation.js';

const localUrl = z.string().max(1000).regex(/^\/uploads\/[A-Za-z0-9_./-]+$/).refine((value) => !value.includes('..'));
const contextSchema = z.object({
  spaceId: z.coerce.number().int().positive().optional(),
  conversationId: z.coerce.number().int().positive(),
  triggerMessageId: z.coerce.number().int().positive().optional(),
});

async function resolveHumanUser(candidateId, ownerId) {
  const candidate = candidateId ? await dbGet('SELECT id, role FROM users WHERE id = ?', [candidateId]) : null;
  if (candidate && candidate.role !== 'agent') return Number(candidate.id);
  const owner = ownerId && Number(ownerId) !== Number(candidateId)
    ? await dbGet('SELECT id, role FROM users WHERE id = ?', [ownerId])
    : candidate;
  if (owner && owner.role !== 'agent') return Number(owner.id);
  throw new Error('DOCUMENT_IMPORT_PRINCIPAL_REQUIRED');
}

export async function resolveDocumentImportScope(context) {
  if (context?.source === 'mcp') {
    const bound = z.object({ jobId: z.number().int().positive(), agentId: z.number().int().positive(), spaceId: z.number().int().positive() }).parse(context);
    const job = await dbGet(`SELECT j.conversation_id, j.trigger_user_id, c.created_by, c.space_id
      FROM agent_jobs j JOIN conversations c ON c.id = j.conversation_id
      WHERE j.id = ? AND j.agent_row_id = ? AND c.space_id = ? AND j.status = 'processing'`,
    [bound.jobId, bound.agentId, bound.spaceId]);
    if (!job) throw new Error('DOCUMENT_IMPORT_ACTIVE_JOB_REQUIRED');
    const userId = await resolveHumanUser(job.trigger_user_id, job.created_by);
    return { conversationId: Number(job.conversation_id), spaceId: Number(job.space_id), userId };
  }

  const input = contextSchema.parse({
    spaceId: context?.spaceId ?? context?.space_id,
    conversationId: context?.conversationId ?? context?.conversation_id,
    triggerMessageId: context?.triggerMessageId ?? context?.trigger_message_id,
  });
  const conversation = await dbGet('SELECT id, space_id, created_by FROM conversations WHERE id = ?', [input.conversationId]);
  if (!conversation || (input.spaceId !== undefined && Number(conversation.space_id) !== input.spaceId)) {
    throw new Error('DOCUMENT_IMPORT_SPACE_MISMATCH');
  }
  let triggeredBy = null;
  if (input.triggerMessageId) {
    const message = await dbGet('SELECT sender_id FROM messages WHERE id = ? AND conversation_id = ? AND COALESCE(is_deleted, 0) = 0', [input.triggerMessageId, input.conversationId]);
    triggeredBy = message?.sender_id || null;
  }
  const userId = await resolveHumanUser(triggeredBy, conversation.created_by);
  return { conversationId: input.conversationId, spaceId: Number(conversation.space_id), userId };
}

export async function requireDocumentEditor(userId, projectId) {
  const { effectiveRole } = await getEffectiveRole(userId, { projectId: Number(projectId) });
  if ((ACCESS_LEVEL_VALUES[effectiveRole] ?? 0) < ACCESS_LEVEL_VALUES.editor) throw new Error('DOCUMENT_EDITOR_REQUIRED');
}

export async function readConversationAttachment(value, scope) {
  const url = localUrl.parse(value);
  const file = await dbGet('SELECT id, url, space_id, mime_type, original_name, storage_provider_id FROM files WHERE url = ?', [url]);
  if (!file || Number(file.space_id) !== scope.spaceId || file.storage_provider_id !== 'local') {
    throw new Error('DOCUMENT_ATTACHMENT_ACCESS_DENIED');
  }
  const attached = await dbGet(`SELECT id FROM messages WHERE conversation_id = ? AND COALESCE(is_deleted, 0) = 0
    AND attachments::jsonb @> ?::jsonb LIMIT 1`, [scope.conversationId, JSON.stringify([{ url }])]);
  if (!attached) throw new Error('DOCUMENT_ATTACHMENT_NOT_IN_CONVERSATION');
  const bytes = await readLocalFile(file, SOURCE_LIMIT);
  return { file, bytes, name: file.original_name || url.split('/').pop() };
}

export async function assertJobScope(job, scope) {
  if (!job || Number(job.space_id) !== scope.spaceId || Number(job.conversation_id) !== scope.conversationId || Number(job.requested_by) !== scope.userId) {
    throw new Error('DOCUMENT_IMPORT_ACCESS_DENIED');
  }
}
