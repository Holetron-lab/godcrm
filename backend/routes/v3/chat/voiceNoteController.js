/**
 * Voice notes: a recording made in the chat input is posted back as a system
 * message on the user's behalf — transcript in `content`, audio in `attachments`.
 * The client transcribes through POST /ai/transcribe and uploads the audio
 * through POST /files/upload first; this route only persists the result and
 * never triggers agents.
 */

import { z } from 'zod';
import {
  dbRun, dbGet, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound, forbidden, requireAuth,
} from './chatShared.js';
import { parseAttachments } from './parseAttachments.js';
import { getCommentThreadChildId } from '../../../services/chat/rowAttachment.js';
import { detectLanguage } from '../../../utils/detectLanguage.js';

const voiceNoteSchema = z.object({
  client_id: z.string().min(1).max(64),
  file_id: z.string().min(1).max(128),
  text: z.string().max(20000).default(''),
  duration: z.number().finite().nonnegative().optional(),
});

export default function registerVoiceNoteRoutes(router) {

  // POST /conversations/:id/voice-notes — idempotent on (conversation, client_id)
  router.post('/conversations/:id/voice-notes', requireAuth, async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return badRequest(res, 'Invalid conversation ID');
      const parsed = voiceNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return badRequest(res, `${issue.path.join('.') || 'body'}: ${issue.message}`);
      }
      const { client_id, file_id, text, duration } = parsed.data;
      const userId = req.user.userId;

      const conversation = await dbGet(`SELECT id, type, space_id, is_readonly FROM conversations WHERE id = $1`, [conversationId]);
      if (!conversation) return notFound(res, 'Conversation not found');

      // Same membership policy as POST /messages: participants only, with
      // first-touch auto-join for ticket/row chats.
      const participant = await dbGet(`SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
      if (!participant) {
        if (conversation.type !== 'task' && conversation.type !== 'row') return notFound(res, 'Conversation not found');
        await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW()) ON CONFLICT (conversation_id, user_id) DO NOTHING`, [conversationId, userId]);
      }
      if (conversation.is_readonly) {
        return forbidden(res, JSON.stringify({
          code: 'READONLY_CONVERSATION',
          message: 'This conversation is read-only — non-owners cannot post here.',
          comment_thread_child_id: await getCommentThreadChildId(conversationId),
        }));
      }

      const file = await dbGet(`SELECT id, name, original_name, mime_type, size, url, space_id, uploaded_by FROM files WHERE id = $1`, [file_id]);
      if (!file) return notFound(res, 'Audio file not found');
      if (Number(file.uploaded_by) !== Number(userId)) return forbidden(res, 'Audio file belongs to another user');
      if (!/^audio\//.test(file.mime_type || '')) return badRequest(res, 'file_id must reference an audio upload');
      if (conversation.space_id && file.space_id && Number(file.space_id) !== Number(conversation.space_id)) {
        return badRequest(res, 'Audio file belongs to another space');
      }

      const attachments = [{ id: file.id, name: file.original_name || file.name, type: file.mime_type, size: file.size, url: file.url, ...(duration != null && { duration }) }];
      const metadata = { type: 'voice_note', client_id, actor: { id: userId }, ...(duration != null && { duration }) };
      // sender_id stays the real user (audit + actor avatar); role/sender_type
      // 'system' is what marks it as service-emitted for readers and agents.
      const insert = await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, sender_kind, detected_lang, created_at)
         VALUES ($1, $2, 'system', 'system', $3, 'text', '[]', $4::jsonb, $5::jsonb, 'user', $6, NOW())
         ON CONFLICT (conversation_id, (metadata->>'client_id')) WHERE metadata->>'client_id' IS NOT NULL DO NOTHING
         RETURNING id`,
        [conversationId, userId, text, JSON.stringify(attachments), JSON.stringify(metadata), detectLanguage(text)]
      );
      let messageId = insert.lastInsertRowid;
      if (messageId) {
        await dbRun(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
      } else {
        const existing = await dbGet(`SELECT id FROM messages WHERE conversation_id = $1 AND metadata->>'client_id' = $2 AND sender_id = $3`, [conversationId, client_id, userId]);
        if (!existing) return error(res, 'CLIENT_ID_TAKEN', 'client_id already used by another sender in this conversation', 409);
        messageId = existing.id;
      }

      const message = await dbGet(`SELECT * FROM messages WHERE id = $1`, [messageId]);
      const response = {
        ...message, mentions: [], sender_space: null,
        attachments: parseAttachments(message.attachments),
        metadata: typeof message.metadata === 'string' ? safeJsonParse(message.metadata, {}) : (message.metadata || {}),
      };
      apiLogger.info({ conversationId, messageId, userId, deduplicated: !insert.lastInsertRowid }, 'Voice note posted as system message');
      return insert.lastInsertRowid ? created(res, response) : success(res, response);
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'Error posting voice note');
      return error(res, 'VOICE_NOTE_ERROR', err.message, 500);
    }
  });
}
