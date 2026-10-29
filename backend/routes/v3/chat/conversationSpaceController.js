import { z } from 'zod';
import { withTransactionAsync as withTransaction } from '../../../database/connection.js';
import { canAdminister } from '../../../services/EffectiveRoleService.js';
import { requireAuth, success, error, apiLogger } from './chatShared.js';

const positiveId = z.number().int().positive().max(2147483647);
const inputSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(positiveId),
  body: z.object({ space_id: positiveId }).strict(),
});

// Bind or change standalone chat scope. Existing files retain their own space
// and access rules; inherited row/thread scope is not supported here.
export default function registerConversationSpaceRoutes(router) {
  router.patch('/conversations/:id/space', requireAuth, async (req, res) => {
    const input = inputSchema.safeParse({ id: req.params.id, body: req.body });
    if (!input.success) return error(res, 'INVALID_SPACE_BINDING', 'Expected a positive conversation id and space_id', 400);
    const { id, body: { space_id: spaceId } } = input.data;
    const userId = req.user.userId;
    try {
      const result = await withTransaction(async trx => {
        const conversation = await trx.get('SELECT * FROM conversations WHERE id = $1 FOR UPDATE', [id]);
        if (!conversation) return { status: 404, code: 'CONVERSATION_NOT_FOUND' };
        if (Number(conversation.created_by) !== userId) return { status: 403, code: 'CONVERSATION_OWNER_REQUIRED' };
        const space = await trx.get('SELECT id FROM spaces WHERE id = $1', [spaceId]);
        if (!space) return { status: 404, code: 'SPACE_NOT_FOUND' };
        if (!await canAdminister(userId, { spaceId })) return { status: 403, code: 'SPACE_ADMIN_REQUIRED' };
        if (conversation.type !== 'chat' || conversation.bound_table_id != null || conversation.bound_row_id != null || conversation.parent_conversation_id != null) {
          return { status: 409, code: 'STANDALONE_CHAT_REQUIRED' };
        }
        const child = await trx.get('SELECT id FROM conversations WHERE parent_conversation_id = $1 LIMIT 1', [id]);
        if (child) return { status: 409, code: 'CHAT_HAS_CHILDREN' };
        if (Number(conversation.space_id) === spaceId) return { changed: false };
        const updated = await trx.run('UPDATE conversations SET space_id = $1, updated_at = NOW() WHERE id = $2', [spaceId, id]);
        if (updated.changes !== 1) throw new Error('Conversation binding update did not affect one row');
        return { changed: true, previousSpaceId: conversation.space_id };
      });
      if (result.status) return error(res, result.code, 'Conversation space binding refused', result.status);
      if (result.changed) apiLogger.info({ conversationId: id, userId, previousSpaceId: result.previousSpaceId, spaceId }, 'Changed conversation space binding');
      return success(res, { id, space_id: spaceId });
    } catch (err) {
      apiLogger.error({ err, conversationId: id }, 'Conversation space binding failed');
      return error(res, 'SPACE_BINDING_ERROR', 'Could not bind conversation to space', 500);
    }
  });
}
