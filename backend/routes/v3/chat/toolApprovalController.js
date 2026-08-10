/**
 * Tool Approval Flow routes (Ticket #74075).
 */

import {
  apiLogger,
  success, error, badRequest, notFound,
  approveToolExecution, rejectToolExecution, getPendingApprovals,
  getApprovalRules, updateApprovalRule,
} from './chatShared.js';

export default function registerToolApprovalRoutes(router) {

  // POST /conversations/:id/tools/:messageId/approve
  router.post('/conversations/:id/tools/:messageId/approve', async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const { alwaysAllow } = req.body;
      const result = await approveToolExecution(messageId, req.user.id, !!alwaysAllow);
      return success(res, result);
    } catch (err) {
      apiLogger.error({ error: err.message, messageId: req.params.messageId }, 'Failed to approve tool execution');
      if (err.message.includes('not found') || err.message.includes('not pending')) return badRequest(res, err.message);
      return error(res, 'TOOL_APPROVE_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/tools/:messageId/reject
  router.post('/conversations/:id/tools/:messageId/reject', async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const { reason } = req.body;
      const result = await rejectToolExecution(messageId, req.user.id, reason);
      return success(res, result);
    } catch (err) {
      apiLogger.error({ error: err.message, messageId: req.params.messageId }, 'Failed to reject tool execution');
      if (err.message.includes('not found') || err.message.includes('not pending')) return badRequest(res, err.message);
      return error(res, 'TOOL_REJECT_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/pending-approvals
  router.get('/conversations/:id/pending-approvals', async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const approvals = await getPendingApprovals(conversationId);
      return success(res, approvals);
    } catch (err) {
      apiLogger.error({ error: err.message, conversationId: req.params.id }, 'Failed to get pending approvals');
      return error(res, 'PENDING_APPROVALS_ERROR', err.message, 500);
    }
  });

  // GET /tool-approval-rules
  router.get('/tool-approval-rules', async (req, res) => {
    try {
      const rules = await getApprovalRules();
      return success(res, rules);
    } catch (err) {
      apiLogger.error({ error: err.message }, 'Failed to get tool approval rules');
      return error(res, 'APPROVAL_RULES_ERROR', err.message, 500);
    }
  });

  // PUT /tool-approval-rules/:id
  router.put('/tool-approval-rules/:id', async (req, res) => {
    try {
      const ruleId = parseInt(req.params.id);
      const rule = await updateApprovalRule(ruleId, req.body);
      return success(res, rule);
    } catch (err) {
      apiLogger.error({ error: err.message, ruleId: req.params.id }, 'Failed to update tool approval rule');
      if (err.message.includes('not found')) return notFound(res, err.message);
      return error(res, 'UPDATE_RULE_ERROR', err.message, 500);
    }
  });
}
