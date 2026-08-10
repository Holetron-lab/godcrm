/**
 * Conversation Steps API (ADR-110) and Chain status (ADR-077).
 */

import {
  dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, error, badRequest, notFound,
  requireAuth, ChainHandoffService,
} from './chatShared.js';

export default function registerStepsRoutes(router) {

  // GET /conversations/:id/steps - List step messages
  router.get('/conversations/:id/steps', requireAuth, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (!conversationId || isNaN(conversationId)) return badRequest(res, 'Invalid conversation ID');

      const allowedTypes = ['thinking', 'tool_call', 'tool_result'];
      const typeParam = req.query.type || 'tool_call,tool_result,thinking';
      const requestedTypes = typeParam.split(',').map(t => t.trim()).filter(t => allowedTypes.includes(t));
      if (requestedTypes.length === 0) return badRequest(res, `Invalid type filter. Allowed: ${allowedTypes.join(', ')}`);

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      const conversation = await dbGet(isPostgres() ? `SELECT id FROM conversations WHERE id = $1` : `SELECT id FROM conversations WHERE id = ?`, [conversationId]);
      if (!conversation) return notFound(res, 'Conversation');

      const inPlaceholders = isPostgres() ? requestedTypes.map((_, i) => `$${i + 2}`).join(', ') : requestedTypes.map(() => '?').join(', ');

      const countParams = [conversationId, ...requestedTypes];
      const countRow = await dbGet(
        isPostgres()
          ? `SELECT COUNT(*) as total FROM messages WHERE conversation_id = $1 AND content_type IN (${inPlaceholders}) AND (is_deleted = 0 OR is_deleted IS NULL)`
          : `SELECT COUNT(*) as total FROM messages WHERE conversation_id = ? AND content_type IN (${requestedTypes.map(() => '?').join(', ')}) AND (is_deleted = 0 OR is_deleted IS NULL)`,
        countParams
      );
      const total = countRow?.total || 0;

      const queryParams = [conversationId, ...requestedTypes, limit, offset];
      const inPlaceholdersFetch = isPostgres() ? requestedTypes.map((_, i) => `$${i + 2}`).join(', ') : requestedTypes.map(() => '?').join(', ');

      const steps = await dbAll(
        isPostgres()
          ? `SELECT id, content_type, content, tool_results, created_at FROM messages WHERE conversation_id = $1 AND content_type IN (${inPlaceholdersFetch}) AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC LIMIT $${requestedTypes.length + 2} OFFSET $${requestedTypes.length + 3}`
          : `SELECT id, content_type, content, tool_results, created_at FROM messages WHERE conversation_id = ? AND content_type IN (${requestedTypes.map(() => '?').join(', ')}) AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        queryParams
      );

      const PREVIEW_CHARS = 100;
      const formattedSteps = steps.map(s => {
        let toolName = null;
        if (s.tool_results) { const toolData = safeJsonParse(s.tool_results); toolName = toolData?.tool || toolData?.name || null; }
        if (!toolName && s.content_type === 'tool_call' && s.content) {
          const parsed = safeJsonParse(s.content);
          toolName = parsed?.tool || parsed?.name || null;
          if (!toolName && typeof s.content === 'string' && s.content.length < 100 && !s.content.includes(' ')) toolName = s.content;
        }
        return { id: s.id, type: s.content_type, tool_name: toolName, preview: s.content ? s.content.substring(0, PREVIEW_CHARS) : '', timestamp: s.created_at };
      });

      const hasMore = offset + limit < total;
      return success(res, { steps: formattedSteps, hasMore, nextCursor: hasMore ? page + 1 : null, total });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'ADR-110: Error fetching conversation steps');
      return error(res, 'STEPS_LIST_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/steps/:stepId - Get step detail
  router.get('/conversations/:id/steps/:stepId', requireAuth, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const stepId = parseInt(req.params.stepId);
      if (!conversationId || isNaN(conversationId) || !stepId || isNaN(stepId)) return badRequest(res, 'Invalid conversation or step ID');

      const step = await dbGet(
        isPostgres()
          ? `SELECT id, conversation_id, content_type, role, content, tool_results, agent_id, model_used, tokens_in, tokens_out, created_at FROM messages WHERE id = $1 AND conversation_id = $2 AND content_type IN ('thinking', 'tool_call', 'tool_result') AND (is_deleted = 0 OR is_deleted IS NULL)`
          : `SELECT id, conversation_id, content_type, role, content, tool_results, agent_id, model_used, tokens_in, tokens_out, created_at FROM messages WHERE id = ? AND conversation_id = ? AND content_type IN ('thinking', 'tool_call', 'tool_result') AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [stepId, conversationId]
      );
      if (!step) return notFound(res, 'Step');

      const toolData = step.tool_results ? safeJsonParse(step.tool_results) : null;
      return success(res, {
        id: step.id, type: step.content_type, content: step.content,
        tool_name: toolData?.tool || toolData?.name || null, tool_args: toolData?.args || null,
        metadata: { role: step.role, agent_id: step.agent_id, model: step.model_used, tokens: (step.tokens_in || step.tokens_out) ? { in: step.tokens_in, out: step.tokens_out } : null, result: toolData?.result || null },
        conversation_id: step.conversation_id, created_at: step.created_at,
      });
    } catch (err) {
      apiLogger.error({ err, stepId: req.params.stepId }, 'ADR-110: Error fetching step detail');
      return error(res, 'STEP_DETAIL_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/chain - ADR-077 Task #11: Agent chain status
  router.get('/conversations/:id/chain', requireAuth, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (!conversationId || isNaN(conversationId)) return badRequest(res, 'Invalid conversation ID');

      const conv = await dbGet(isPostgres() ? `SELECT id, bound_table_id, bound_row_id FROM conversations WHERE id = $1` : `SELECT id, bound_table_id, bound_row_id FROM conversations WHERE id = ?`, [conversationId]);
      if (!conv) return notFound(res, 'Conversation');
      if (!conv.bound_table_id || !conv.bound_row_id) return notFound(res, 'Chain — conversation is not bound to a ticket');

      const ticketRow = await dbGet(isPostgres() ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2` : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [conv.bound_row_id, conv.bound_table_id]);
      if (!ticketRow) return notFound(res, 'Chain — bound ticket row not found');

      const ticketData = safeJsonParse(ticketRow.data, {});
      const chainId = ticketData._chain?.chain_id;
      if (!chainId) return notFound(res, 'Chain — ticket has no chain metadata');

      const chainStatus = await ChainHandoffService.getChainStatus(chainId);
      if (chainStatus.status === 'not_found') return notFound(res, `Chain '${chainId}'`);

      apiLogger.info({ conversationId, chainId, status: chainStatus.status }, 'ADR-077 Task #11: Fetched chain status for conversation');
      return success(res, { chain_id: chainStatus.chain_id, status: chainStatus.status, progress: chainStatus.progress, tasks: chainStatus.tasks, current_step: chainStatus.current_step, next_step: chainStatus.next_step });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'ADR-077: Error fetching chain status for conversation');
      return error(res, 'CHAIN_STATUS_ERROR', err.message, 500);
    }
  });
}
