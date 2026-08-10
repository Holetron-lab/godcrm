/**
 * Miscellaneous Tool Handlers
 *
 * Handles: view_conversation_steps, view_step_detail, run_code, validate_code,
 *          run_code_loop, get_api_documentation, manage_plan, save_conversation_summary
 */

import { dbGet, dbRun, dbAll, isPostgres, safeJsonParse } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';
import { executeCodeTool } from '../CodeToolsService.js';
import { handleManagePlan } from '../chat/agent-execution-shared.js';

/**
 * Miscellaneous tool handlers
 */
export const miscToolHandlers = {
  // === CONVERSATION INTROSPECTION ===
  async view_conversation_steps({ conversation_id }) {
    const steps = await dbAll(
      `SELECT id, content_type, role, content, tool_results, agent_id, created_at
       FROM messages
       WHERE conversation_id = ? AND content_type IN ('thinking', 'tool_call', 'tool_result')
       ORDER BY created_at ASC`,
      [conversation_id]
    );

    return {
      success: true,
      conversation_id,
      total_steps: steps.length,
      steps: steps.map((s, i) => {
        const toolData = s.tool_results ? safeJsonParse(s.tool_results) : null;
        const toolName = toolData?.tool || (s.content_type === 'tool_call' ? s.content : null);
        return {
          index: i + 1,
          message_id: s.id,
          type: s.content_type,
          tool: toolName || null,
          preview: s.content?.substring(0, 150) || '',
          timestamp: s.created_at
        };
      })
    };
  },

  async view_step_detail({ message_id }) {
    const msg = await dbGet(
      `SELECT id, conversation_id, content_type, role, content, tool_results,
              agent_id, model_used, tokens_in, tokens_out, created_at
       FROM messages WHERE id = ?`,
      [message_id]
    );

    if (!msg) return { error: `Message ${message_id} not found` };

    const toolData = msg.tool_results ? safeJsonParse(msg.tool_results) : null;

    return {
      success: true,
      message_id: msg.id,
      conversation_id: msg.conversation_id,
      type: msg.content_type,
      role: msg.role,
      tool: toolData?.tool || null,
      args: toolData?.args || null,
      content: msg.content,
      result: toolData?.result || null,
      model: msg.model_used,
      tokens: msg.tokens_in || msg.tokens_out ? { in: msg.tokens_in, out: msg.tokens_out } : null,
      timestamp: msg.created_at
    };
  },

  // === CODE EXECUTION (ADR-032) ===
  async run_code(args, context) {
    return executeCodeTool('run_code', args, context);
  },

  async validate_code(args, context) {
    return executeCodeTool('validate_code', args, context);
  },

  async run_code_loop(args, context) {
    return executeCodeTool('run_code_loop', args, context);
  },

  // === API DOCUMENTATION (ADR-036) ===
  async get_api_documentation({ include_tools = true, include_endpoints = true, filter_tag } = {}) {
    try {
      // Lazy import to avoid circular dependency
      const { swaggerOptions } = await import('../../swagger.config.js');
      const swaggerJsdoc = (await import('swagger-jsdoc')).default;
      const swaggerSpec = swaggerJsdoc(swaggerOptions);

      const result = {
        api_version: swaggerSpec.info?.version || '0.003.001',
        base_url: '/api/v3',
        auth_type: 'Bearer JWT in Authorization header'
      };

      // Include endpoints
      if (include_endpoints) {
        let paths = swaggerSpec.paths || {};

        // Filter by tag if specified
        if (filter_tag) {
          const filteredPaths = {};
          for (const [path, methods] of Object.entries(paths)) {
            const filteredMethods = {};
            for (const [method, def] of Object.entries(methods)) {
              if (def.tags && def.tags.includes(filter_tag)) {
                filteredMethods[method] = def;
              }
            }
            if (Object.keys(filteredMethods).length > 0) {
              filteredPaths[path] = filteredMethods;
            }
          }
          paths = filteredPaths;
        }

        result.endpoints = paths;
        result.endpoint_count = Object.keys(paths).length;
        result.available_tags = (swaggerSpec.tags || []).map(t => ({ name: t.name, description: t.description }));
      }

      // Include agent tools — need lazy reference to AGENT_TOOLS
      if (include_tools) {
        const { AGENT_TOOLS } = await import('./tool-definitions.js');
        result.agent_tools = AGENT_TOOLS.filter(t => t.function?.name !== 'get_api_documentation').map(tool => ({
          name: tool.function?.name,
          description: tool.function?.description,
          parameters: tool.function?.parameters
        }));
        result.tool_count = result.agent_tools.length;
      }

      // Usage instructions
      result.usage = {
        response_format: '{ success: boolean, data: any, timestamp: string }',
        common_operations: {
          'List resources': 'GET /resource',
          'Get single': 'GET /resource/:id',
          'Create': 'POST /resource',
          'Update': 'PUT /resource/:id',
          'Delete': 'DELETE /resource/:id'
        }
      };

      return result;
    } catch (error) {
      aiLogger.error({ err: error }, 'Error getting API documentation');
      return { error: 'Failed to load API documentation: ' + error.message };
    }
  },

  // === PLANNING TOOL (ADR-113) ===
  // manage_plan is handled via the shared handleManagePlan() from
  // agent-execution-shared.js.  This toolHandlers entry delegates to it
  // in validation-only mode (no conversationId).
  async manage_plan(args) {
    return handleManagePlan(args, null, 'unknown');
  },

  // === SUMMARY TOOL ===
  async save_conversation_summary({ conversation_id, summary_text }, userId) {
    if (!conversation_id || !summary_text) {
      return { error: 'conversation_id and summary_text are required' };
    }

    try {
      const pg = isPostgres();

      // 1. Verify conversation exists
      const conv = await dbGet(
        pg ? 'SELECT id, agent_id FROM conversations WHERE id = $1'
           : 'SELECT id, agent_id FROM conversations WHERE id = ?',
        [conversation_id]
      );
      if (!conv) {
        return { error: `Conversation ${conversation_id} not found` };
      }

      // 2. Save summary as a message from the Summary Agent (SUMMARY_AGENT_ID = 85572)
      const SUMMARY_AGENT_ID = 85572;
      const metadata = JSON.stringify({
        is_summary: true,
        agent_row_id: SUMMARY_AGENT_ID,
        generated_at: new Date().toISOString(),
      });

      const messageResult = await dbRun(
        pg ? `INSERT INTO messages (conversation_id, role, content, content_type, sender_type, agent_id, metadata, created_at)
              VALUES ($1, 'assistant', $2, 'text', 'agent', $3, $4, NOW())
              RETURNING id`
           : `INSERT INTO messages (conversation_id, role, content, content_type, sender_type, agent_id, metadata, created_at)
              VALUES (?, 'assistant', ?, 'text', 'agent', ?, ?, datetime('now'))`,
        [conversation_id, summary_text, SUMMARY_AGENT_ID, metadata]
      );

      const messageId = pg ? messageResult?.rows?.[0]?.id : messageResult?.lastID;

      // 3. Update conversations table — overwrite summary, save message link
      await dbRun(
        pg ? `UPDATE conversations SET summary = $1, summary_message_id = $2, updated_at = NOW() WHERE id = $3`
           : `UPDATE conversations SET summary = ?, summary_message_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [summary_text, messageId, conversation_id]
      );

      aiLogger.info({ conversation_id, messageId }, 'Conversation summary saved');

      return {
        success: true,
        message_id: messageId,
        conversation_id,
        summary_length: summary_text.length,
        note: 'Summary saved to conversation. Previous summary overwritten. Old summary accessible via message history.'
      };
    } catch (err) {
      aiLogger.error({ err, conversation_id }, 'Failed to save conversation summary');
      return { error: `Failed to save summary: ${err.message}` };
    }
  }
};
