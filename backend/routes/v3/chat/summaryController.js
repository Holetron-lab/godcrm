/**
 * Conversation summaries routes.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound,
  requireAuth, saveStepMessage,
  generateSummaryPrompt, executeSimpleAI,
} from './chatShared.js';

const SUMMARY_AGENT_ID = 85543;

const SUMMARY_SYSTEM_PROMPT = `You are a concise conversation summarizer. Produce a structured summary in TODO/checklist format using Markdown.

Format your response EXACTLY like this:

## Summary

**Key decisions:**
- [ ] Decision or action item 1
- [ ] Decision or action item 2
- [x] Completed item (if clearly done in the conversation)

**What was done:**
- Brief bullet point 1
- Brief bullet point 2

**Status:** One sentence about current state.

Keep it brief — max 8-10 bullet points total. Use checkboxes (- [ ] / - [x]) for action items and plain bullets (-) for facts/status.`;

export default function registerSummaryRoutes(router) {

  // GET /conversations/:id/summaries - List past summaries
  router.get('/conversations/:id/summaries', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');

    try {
      const summaryMessages = await dbAll(
        isPostgres()
          ? `SELECT id, conversation_id, content, agent_id, model_used, metadata, created_at FROM messages WHERE conversation_id = $1 AND agent_id = $2 AND role = 'assistant' AND metadata::text LIKE '%"is_summary":true%' ORDER BY created_at ASC`
          : `SELECT id, conversation_id, content, agent_id, model_used, metadata, created_at FROM messages WHERE conversation_id = ? AND agent_id = ? AND role = 'assistant' AND metadata LIKE '%"is_summary":true%' ORDER BY created_at ASC`,
        [conversationId, SUMMARY_AGENT_ID]
      );

      const summaries = summaryMessages.map((m, idx) => {
        const meta = m.metadata ? (typeof m.metadata === 'string' ? safeJsonParse(m.metadata, {}) : m.metadata) : {};
        return {
          id: m.id, conversation_id: m.conversation_id, chunk_number: idx + 1,
          messages_start_id: meta.messages_start_id || null, messages_end_id: meta.messages_end_id || null,
          messages_count: meta.messages_count || 0, summary: m.content, summary_model: m.model_used || 'unknown',
          created_at: m.created_at, agent_id: m.agent_id,
          agent_name: meta.agent_name || 'Summary', agent_icon: meta.agent_icon || null, agent_color: meta.agent_color || null,
        };
      });

      return success(res, { summaries });
    } catch (err) {
      apiLogger.error({ err, conversationId }, 'Error fetching conversation summaries');
      return error(res, 'SUMMARIES_LIST_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/summaries - Generate a new summary
  router.post('/conversations/:id/summaries', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');

    try {
      const conv = await dbGet(isPostgres() ? 'SELECT id, settings FROM conversations WHERE id = $1' : 'SELECT id, settings FROM conversations WHERE id = ?', [conversationId]);
      if (!conv) return notFound(res, 'Conversation');

      const messages = await dbAll(
        isPostgres()
          ? `SELECT id, role, content, content_type, sender_type, created_at FROM messages WHERE conversation_id = $1 AND (content_type = 'text' OR content_type IS NULL) ORDER BY created_at ASC`
          : `SELECT id, role, content, content_type, sender_type, created_at FROM messages WHERE conversation_id = ? AND (content_type = 'text' OR content_type IS NULL) ORDER BY created_at ASC`,
        [conversationId]
      );
      if (messages.length === 0) return badRequest(res, 'No messages to summarize');

      const prompt = generateSummaryPrompt(messages);
      const convSettings = safeJsonParse(conv.settings, {});
      const summaryModel = convSettings.summary_model || req.body.model || 'gpt-4o-mini';
      const summaryAgentId = convSettings.summary_agent_id || req.body.summary_agent_id || null;

      let summaryText;

      async function tryGenerateSummary(systemPrompt, model) {
        let result = await executeSimpleAI({ input: prompt, systemPrompt, model });
        if (result?.success && result?.content) return result.content;
        apiLogger.warn({ conversationId, error: result?.error, model, success: result?.success }, 'Summary: primary provider failed, trying claude-code fallback');
        result = await executeSimpleAI({ input: prompt, systemPrompt, model: 'sonnet', provider: 'claude-code' });
        if (result?.success && result?.content) return result.content;
        apiLogger.error({ conversationId, error: result?.error, success: result?.success }, 'Summary: all providers failed');
        return null;
      }

      if (summaryAgentId) {
        const agentRow = await dbGet(isPostgres() ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1` : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`, [summaryAgentId]);
        if (agentRow) {
          const agentData = safeJsonParse(agentRow.data, {});
          const agentConfig = { systemPrompt: agentData.system_prompt || 'You are a concise summarizer. Produce a brief summary of the conversation.', model: agentData.model || summaryModel };
          summaryText = await tryGenerateSummary(agentConfig.systemPrompt, agentConfig.model);
        } else {
          summaryText = await tryGenerateSummary(SUMMARY_SYSTEM_PROMPT, summaryModel);
        }
      } else {
        summaryText = await tryGenerateSummary(SUMMARY_SYSTEM_PROMPT, summaryModel);
      }

      if (!summaryText) return error(res, 'SUMMARY_GENERATION_FAILED', 'All AI providers failed to generate summary. Check API keys configuration.', 500);

      const existingSummaries = await dbAll(
        isPostgres()
          ? `SELECT id FROM messages WHERE conversation_id = $1 AND agent_id = $2 AND role = 'assistant' AND metadata::text LIKE '%"is_summary":true%' ORDER BY created_at ASC`
          : `SELECT id FROM messages WHERE conversation_id = ? AND agent_id = ? AND role = 'assistant' AND metadata LIKE '%"is_summary":true%' ORDER BY created_at ASC`,
        [conversationId, SUMMARY_AGENT_ID]
      );
      const nextChunkNumber = existingSummaries.length + 1;
      const messagesStartId = messages[0].id;
      const messagesEndId = messages[messages.length - 1].id;

      let agentName = 'Summary', agentIcon = null, agentColor = '#3b82f6';
      try {
        const agentRow = await dbGet(isPostgres() ? `SELECT data FROM table_rows WHERE id = $1` : `SELECT data FROM table_rows WHERE id = ?`, [SUMMARY_AGENT_ID]);
        if (agentRow) { const agentData = safeJsonParse(agentRow.data, {}); agentName = agentData.name || 'Summary'; agentIcon = agentData.icon || null; agentColor = agentData.color || '#3b82f6'; }
      } catch (agentErr) { apiLogger.warn({ err: agentErr.message }, 'Failed to resolve Summary Agent info, using defaults'); }

      const summaryMetadata = JSON.stringify({
        is_summary: true, agent_name: agentName, agent_icon: agentIcon, agent_color: agentColor, agent_row_id: SUMMARY_AGENT_ID,
        chunk_number: nextChunkNumber, messages_start_id: messagesStartId, messages_end_id: messagesEndId, messages_count: messages.length,
      });

      await saveStepMessage(conversationId, { content: summaryText, contentType: 'text', role: 'assistant', senderType: 'agent', agentId: SUMMARY_AGENT_ID, modelUsed: summaryModel, metadata: summaryMetadata });

      await dbRun(
        isPostgres()
          ? `UPDATE conversations SET summary = $1, summary_message_id = (SELECT id FROM messages WHERE conversation_id = $2 AND agent_id = $3 AND role = 'assistant' AND metadata::text LIKE '%"is_summary":true%' ORDER BY created_at DESC LIMIT 1), updated_at = NOW() WHERE id = $2`
          : `UPDATE conversations SET summary = ?, summary_message_id = (SELECT id FROM messages WHERE conversation_id = ? AND agent_id = ? AND role = 'assistant' AND metadata LIKE '%"is_summary":true%' ORDER BY created_at DESC LIMIT 1), updated_at = datetime('now') WHERE id = ?`,
        isPostgres() ? [summaryText, conversationId, SUMMARY_AGENT_ID] : [summaryText, conversationId, SUMMARY_AGENT_ID, conversationId]
      ).catch(err => { apiLogger.warn({ err: err.message, conversationId }, 'Failed to update conversations.summary'); });

      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, summary_model, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, summary_model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [conversationId, nextChunkNumber, messagesStartId, messagesEndId, messages.length, summaryText, summaryModel]
      ).catch(legacyErr => { apiLogger.warn({ err: legacyErr.message, conversationId }, 'Failed to save to conversation_summaries (legacy), summary message saved successfully'); });

      const savedSummary = {
        id: null, conversation_id: conversationId, chunk_number: nextChunkNumber,
        messages_start_id: messagesStartId, messages_end_id: messagesEndId, messages_count: messages.length,
        summary: summaryText, summary_model: summaryModel, created_at: new Date().toISOString(),
        agent_id: SUMMARY_AGENT_ID, agent_name: agentName, agent_icon: agentIcon, agent_color: agentColor,
      };

      apiLogger.info({ conversationId, chunkNumber: nextChunkNumber, agentId: SUMMARY_AGENT_ID }, 'Chat summary saved as agent message');
      return created(res, { summary: savedSummary });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'Error generating conversation summary');
      return error(res, 'SUMMARY_GENERATE_ERROR', err.message, 500);
    }
  });
}
