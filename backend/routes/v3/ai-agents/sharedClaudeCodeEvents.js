/**
 * Claude Code event handler builder for agent execution.
 * Handles terminal command tracking and step message saving.
 */

import { dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { saveStepMessage } from './shared.js';

/**
 * Build a Claude Code onEvent handler that tracks terminal commands
 * and saves step messages to the conversation.
 *
 * @param {Object} opts
 * @param {number} opts.conversationId
 * @param {number} opts.agentId
 * @param {string} opts.model
 * @param {number} opts.userId
 * @returns {{ onEvent: Function|undefined, toolUseMap: Map, getTerminalSessionId: Function }}
 */
export async function buildClaudeCodeEventHandler({ conversationId, agentId, model, userId }) {
  const toolUseMap = new Map();
  let agentTerminalSessionId = null;

  if (conversationId) {
    try {
      const agentSessionTitle = `Agent #${agentId}`;
      let agentSession = await dbGet(
        `SELECT * FROM terminal_sessions WHERE user_id = $1 AND title = $2 AND status = $3`,
        [userId, agentSessionTitle, 'active']
      );
      if (!agentSession) {
        const { createSession } = await import('../../../services/TerminalService.js');
        agentSession = await createSession(userId, agentSessionTitle);
      }
      agentTerminalSessionId = agentSession.id;
    } catch { /* terminal not critical */ }
  }

  const onEvent = conversationId ? (event) => {
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          saveStepMessage(conversationId, {
            content: block.name, contentType: 'tool_call', role: 'assistant',
            senderType: 'agent', agentId, modelUsed: model,
            toolResults: { tool: block.name, args: block.input, terminal_session_id: agentTerminalSessionId }
          }).catch(() => {});
          let insertPromise = null;
          if (block.name === 'Bash' && block.input?.command && agentTerminalSessionId) {
            insertPromise = dbRun(
              `INSERT INTO terminal_commands (session_id, command, risk_level, approval_status, source, agent_name)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [agentTerminalSessionId, block.input.command, 'safe', 'auto', 'agent', `Agent #${agentId}`]
            ).then(result => {
              apiLogger.debug({ cmdId: result?.lastInsertRowid, command: block.input?.command?.substring(0, 50) }, 'Terminal command inserted');
              return result;
            }).catch(err => {
              apiLogger.warn({ err }, 'Failed to insert terminal command');
              return null;
            });
          }
          toolUseMap.set(block.id, { name: block.name, command: block.input?.command, insertPromise });
        } else if (block.type === 'text' && block.text) {
          saveStepMessage(conversationId, {
            content: block.text, contentType: 'thinking', role: 'assistant',
            senderType: 'agent', agentId, modelUsed: model
          }).catch(() => {});
        }
      }
    } else if (event.type === 'user' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_result') {
          const resultContent = typeof block.content === 'string'
            ? block.content : JSON.stringify(block.content);
          const truncated = resultContent.length > 2000 ? resultContent.substring(0, 2000) + '...' : resultContent;
          saveStepMessage(conversationId, {
            content: truncated, contentType: 'tool_result', role: 'tool',
            senderType: 'agent', agentId,
            toolResults: { tool_use_id: block.tool_use_id, content: truncated }
          }).catch(() => {});
          const toolInfo = toolUseMap.get(block.tool_use_id);
          if (toolInfo?.insertPromise) {
            const output = resultContent;
            const exitCode = block.is_error ? 1 : 0;
            toolInfo.insertPromise.then(result => {
              const cmdId = result?.lastInsertRowid;
              if (cmdId) {
                dbRun(
                  `UPDATE terminal_commands SET output = $1, exit_code = $2, completed_at = NOW() WHERE id = $3`,
                  [output.substring(0, 100 * 1024), exitCode, cmdId]
                ).catch(err => apiLogger.warn({ err, cmdId }, 'Failed to update terminal command'));
              }
            }).catch(() => {});
          }
        }
      }
    }
  } : undefined;

  return { onEvent, toolUseMap };
}
