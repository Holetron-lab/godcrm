/** Chat agent execution: executeAgentResponse + triggerAgentResponse. */
import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  sharedResolveAgentProvider, sharedBuildAgentSystemPrompt, fetchBoundRowContext, fetchAgentSkills, detectProvider,
  loadConversationHistory, executeAgentToolLoop, saveStepMessage, resolveAllowedTools,
  createAgentStatusPlaceholder, updateAgentStatus, finalizeAgentStatus, findExistingAgentStatus, resetAgentStatusForReuse,
  logAgentMentioned, logMessageSent, logAgentError, logTaskCompleted, createAndDispatchJob,
  buildAIContext, parseAutoSummarySettings, searchSimilarSummaries, parseVectorSearchSettings,
  BASE_URL_FOR_ATTACHMENTS,
} from './chatShared.js';
import { resolveAgentSenderId } from './chatAgentHelpers.js';
import { getAgentTableIds } from '../../../services/agentTableResolver.js';
import { _triggerAutoSummary, _handleDelegation, _handleTicketStatusDirective, callAgentAI } from './chatAgentDelegation.js';

/**
 * Normalize agent config: resolve column-ID keys to column-name keys.
 * Some table rows store values under numeric column IDs (e.g. "15592": 10000)
 * instead of named keys ("max_iterations": 10000). This normalizes them.
 */
function normalizeAgentConfig(config) {
  if (!config || typeof config !== 'object') return config;
  // Known column-ID → column-name mappings for Agents table (1784)
  const COL_MAP = {
    '13288': 'color',
    '13289': 'operator_id',
    '13290': 'model',
    '15592': 'max_iterations',
    '18764': 'response_mode',
  };
  const out = { ...config };
  for (const [colId, colName] of Object.entries(COL_MAP)) {
    if (colId in out && !(colName in out)) {
      out[colName] = out[colId];
    }
    delete out[colId];
  }
  return out;
}

// Helper: clear processing state on conversation
async function _clearProcessingState(conversationId) {
  await dbRun(
    isPostgres()
      ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`
      : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now') WHERE id = ?`,
    [conversationId]
  ).catch(err => apiLogger.error({ err }, 'ADR-093: Failed to clear processing state'));
}

// Helper: always create a FRESH agent status placeholder.
// Previously this reused existing statuses (UPDATE in-place), but that kept
// the old message ID which is lower than the user's latest message ID.
// Incremental polling (?after=lastId) never sees messages with lower IDs,
// so the frontend couldn't detect the agent was working.
// Now we always DELETE + INSERT to get a fresh high ID that polling catches.
async function _resolveStatusPlaceholder(conversationId, agent, agentRowId) {
  const agentIcon = agent._agentConfig?.icon || agent._agentConfig?.emoji || null;
  const agentColor = agent._agentConfig?.color || null;
  const agentName = agent.name || agent._agentConfig?.name || 'AI Agent';
  return createAgentStatusPlaceholder(conversationId, { agentName, agentIcon, agentColor, agentRowId, senderId: agent.id || null });
}

/** ADR-093: Unified agent execution. */
async function executeAgentResponse(conversationId, agent, triggeredByUserId, options = {}) {
  const { agent_mode = 'agent', thinking_enabled = false, message_content = '', attachments = [], attachmentBaseUrl = '', invocation_type = null } = options;
  const _activityStartTime = Date.now();
  let statusMessageId = null;

  try {
    let agentConfig = normalizeAgentConfig(agent._agentConfig || {});
    if (!agentConfig.operator_id && agent.managed_by_agent_row_id) {
      const row = await dbGet(
        isPostgres()
          ? `SELECT data FROM table_rows WHERE id = $1`
          : `SELECT data FROM table_rows WHERE id = ?`,
        [agent.managed_by_agent_row_id]
      );
      if (row) agentConfig = normalizeAgentConfig(safeJsonParse(row.data, {}));
    }

    const resolved = await sharedResolveAgentProvider(agentConfig);
    const { isClaudeCode } = detectProvider(resolved.provider, resolved.model);

    if (isClaudeCode) {
      const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
      const agentName = agent.name || agent._agentConfig?.name || null;

      apiLogger.info({ conversationId, agentName, provider: resolved.provider },
        'Strategy B: Dispatching async job for claude-code agent');

      logAgentMentioned(agentName || 'unknown', conversationId, triggeredByUserId);

      // Set is_processing on conversation so frontend starts polling agent_status
      await dbRun(
        isPostgres()
          ? `UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1`
          : `UPDATE conversations SET is_processing = 1, processing_started_at = datetime('now'), processing_agent_id = ?, processing_agent_name = ?, updated_at = datetime('now') WHERE id = ?`,
        isPostgres() ? [conversationId, agentRowId, agentName] : [agentRowId, agentName, conversationId]
      );

      let asyncStatusMsgId = null;
      try { asyncStatusMsgId = await _resolveStatusPlaceholder(conversationId, agent, agentRowId); }
      catch (placeholderErr) { apiLogger.error({ err: placeholderErr, conversationId }, 'Strategy B: Failed to create/reuse status placeholder'); }

      const job = await createAndDispatchJob({
        conversationId, agent, triggeredByUserId, messageContent: message_content,
        options: { agent_mode, thinking_enabled, attachments, attachmentBaseUrl },
        statusMessageId: asyncStatusMsgId,
        invocationType: invocation_type,
      });

      if (job.skipped) {
        apiLogger.info({ conversationId, agentName, existingJobId: job.jobId },
          'Strategy B: Skipped — active worker already running for this agent');
        // Clean up unused status placeholder
        if (asyncStatusMsgId) {
          finalizeAgentStatus(asyncStatusMsgId, null).catch(() => {});
        }
        return;
      }

      if (asyncStatusMsgId && job.jobId) {
        updateAgentStatus(asyncStatusMsgId, 'starting', 'Worker starting...', {
          job_id: job.jobId, job_db_id: job.id,
        }).catch(err => apiLogger.error({ err }, 'Failed to update placeholder with job_id'));
      }

      apiLogger.info({ conversationId, jobId: job.jobId, jobDbId: job.id, agentName, statusMessageId: asyncStatusMsgId },
        'Strategy B: Async job dispatched (claude-code), returning immediately');
      return;
    }

    // ── Original sync path for non-claude-code providers ──
    const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
    const agentName = agent.name || agent._agentConfig?.name || null;

    // ADR-0057 Option 2 (2026-05-12): N concurrent runs of the same agent in
    // one conversation are allowed. The sync-path skip-guard against
    // is_processing+processing_agent_id has been removed alongside create.js's
    // duplicate-active-job check.

    await dbRun(
      isPostgres()
        ? `UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1`
        : `UPDATE conversations SET is_processing = 1, processing_started_at = datetime('now'), processing_agent_id = ?, processing_agent_name = ?, updated_at = datetime('now') WHERE id = ?`,
      isPostgres() ? [conversationId, agentRowId, agentName] : [agentRowId, agentName, conversationId]
    );

    logAgentMentioned(agentName || 'unknown', conversationId, triggeredByUserId);

    try { statusMessageId = await _resolveStatusPlaceholder(conversationId, agent, agentRowId); }
    catch (placeholderErr) { apiLogger.error({ err: placeholderErr, conversationId }, 'Failed to create/reuse status placeholder — continuing without'); }

    await triggerAgentResponse(conversationId, message_content, agent, triggeredByUserId, { agent_mode, thinking_enabled, attachments, attachmentBaseUrl, statusMessageId });

    logTaskCompleted(agentName || 'unknown', conversationId, { duration_ms: Date.now() - _activityStartTime });

    await _clearProcessingState(conversationId);

  } catch (err) {
    apiLogger.error({ err, conversationId, agentName: agent.name }, 'ADR-093: executeAgentResponse failed');
    if (statusMessageId) {
      updateAgentStatus(statusMessageId, 'error', `Error: ${(err.message || 'Unknown error').substring(0, 100)}`)
        .catch(statusErr => apiLogger.error({ err: statusErr }, 'Failed to update agent status to error'));
    }
    const agentLabel = agent.name || agent._agentConfig?.name || 'AI Agent';
    const errMsg = `Agent "${agentLabel}" encountered an error: ${err.message || 'Unknown error'}. Please try again.`;
    try {
      await dbRun(isPostgres()
        ? `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at) VALUES ($1, 'system', 'system', $2, 'system', NOW(), NOW())`
        : `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at) VALUES (?, 'system', 'system', ?, 'system', datetime('now'), datetime('now'))`,
        [conversationId, errMsg]);
    } catch (msgErr) { apiLogger.error({ err: msgErr }, 'Failed to save error message to conversation'); }
    logAgentError(agent.name || 'unknown', conversationId, err);
    await _clearProcessingState(conversationId);
  }
}

/**
 * Trigger agent response for a mention (async, non-blocking)
 */
async function triggerAgentResponse(conversationId, userMessage, agent, userId, options = {}) {
  const { agent_mode = 'agent', thinking_enabled = false, attachments = [], attachmentBaseUrl = '', statusMessageId = null } = options;
  let _finalResponseText = '';
  try {
    apiLogger.info({ conversationId, agentName: agent.name, isAiAgentRow: !!agent._isAiAgentRow, agent_mode, thinking_enabled }, 'Triggering agent response');

    let agentConfig = {};
    if (agent._agentConfig) {
      agentConfig = normalizeAgentConfig(agent._agentConfig);
      apiLogger.info({ agentName: agent.name, operatorId: agentConfig.operator_id }, 'Using config from AI Agents table');
    } else if (agent.managed_by_agent_row_id) {
      const agentRow = await dbGet(
        isPostgres() ? `SELECT data FROM table_rows WHERE id = $1` : `SELECT data FROM table_rows WHERE id = ?`,
        [agent.managed_by_agent_row_id]
      );
      if (agentRow) agentConfig = normalizeAgentConfig(safeJsonParse(agentRow.data, {}));
    }

    if (!agentConfig.operator_id) {
      apiLogger.info({ agentName: agent.name }, 'No operator_id in config, searching AI Agents table');
      // ADR-164 Phase 3a: marker-aware agent-table resolve. tableIn is internal integer PKs — safe to inline.
      const agentTableIds = await getAgentTableIds();
      const aiAgentRow = agentTableIds.length === 0 ? null : await dbGet(
        isPostgres()
          ? `SELECT tr.data FROM table_rows tr WHERE tr.table_id IN (${agentTableIds.join(',')}) AND tr.data->>'name' ILIKE $1 LIMIT 1`
          : `SELECT tr.data FROM table_rows tr WHERE tr.table_id IN (${agentTableIds.join(',')}) AND json_extract(tr.data, '$.name') LIKE ? LIMIT 1`,
        [`%${agent.name}%`]
      );
      if (aiAgentRow) {
        const foundConfig = safeJsonParse(aiAgentRow.data, {});
        apiLogger.info({ agentName: agent.name, foundOperatorId: foundConfig.operator_id }, 'Found agent config in AI Agents table');
        agentConfig = { ...agentConfig, ...foundConfig };
      }
    }

    if (!agentConfig.operator_id) {
      apiLogger.info({ agentName: agent.name }, 'Using default Anthropic operator');
      const defaultOperator = await dbGet(
        isPostgres()
          ? `SELECT tr.id, tr.data FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id WHERE ut.name = 'AI Operators' AND tr.data->>'provider' = 'anthropic' AND tr.data->>'api_key' IS NOT NULL ORDER BY tr.id DESC LIMIT 1`
          : `SELECT tr.id, tr.data FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id WHERE ut.name = 'AI Operators' AND json_extract(tr.data, '$.provider') = 'anthropic' AND json_extract(tr.data, '$.api_key') IS NOT NULL ORDER BY tr.id DESC LIMIT 1`
      );
      if (defaultOperator) {
        agentConfig.operator_id = defaultOperator.id;
        agentConfig.model = agentConfig.model || 'claude-sonnet-4-20250514';
        apiLogger.info({ agentName: agent.name, operatorId: defaultOperator.id }, 'Using default Anthropic operator');
      }
    }

    const formattedHistory = await loadConversationHistory(conversationId, agentConfig, agent.id);

    // Enrich user message with attachment descriptions
    let enrichedUserMessage = userMessage;
    if (attachments && attachments.length > 0) {
      const baseUrl = attachmentBaseUrl || BASE_URL_FOR_ATTACHMENTS || 'https://crm.hltrn.cc';
      const fileAtts = attachments.filter(a => a.type !== 'row_reference');
      const rowRefAtts = attachments.filter(a => a.type === 'row_reference' && a.rowReference);

      const parts = [];
      if (fileAtts.length > 0) {
        const uploadBasePath = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
        const fileDescriptions = fileAtts.map(a => {
          const url = a.url?.startsWith('http') ? a.url : (a.url?.startsWith('/') ? `${baseUrl}${a.url}` : (a.url || 'no URL'));
          let fsPath = '';
          const urlPath = a.url || '';
          const uploadsIdx = urlPath.indexOf('/uploads/');
          if (uploadsIdx !== -1) {
            fsPath = `${uploadBasePath}${urlPath.substring(uploadsIdx + '/uploads'.length)}`;
          }
          return `- ${a.name || 'file'} (${a.type || 'unknown type'}, ${a.size ? Math.round(a.size / 1024) + 'KB' : 'unknown size'}): ${url}${fsPath ? `\n  Filesystem path: ${fsPath}` : ''}`;
        }).join('\n');
        parts.push(`[Attached files]\n${fileDescriptions}`);
      }
      if (rowRefAtts.length > 0) {
        const rowDescriptions = rowRefAtts.map(a => {
          const ref = a.rowReference;
          const icon = ref.table_icon ? `${ref.table_icon} ` : '';
          const title = ref.row_title || `#${ref.row_id}`;
          return `- ${icon}${ref.table_name}: ${title} (table_id=${ref.table_id}, row_id=${ref.row_id})`;
        }).join('\n');
        parts.push(`[Attached rows]\n${rowDescriptions}\nUse get_table_row(table_id, row_id) if you need full data for any of these.`);
      }
      enrichedUserMessage = `${userMessage}\n\n${parts.join('\n\n')}`;
      apiLogger.info({ conversationId, attachmentCount: attachments.length, baseUrl }, 'Bug fix: Enriched user message with attachment info for AI');
    }

    const boundRowContext = await fetchBoundRowContext(conversationId);
    if (boundRowContext) {
      apiLogger.debug({ boundRowContext: { table_id: boundRowContext.table_id, row_id: boundRowContext.row_id, table_name: boundRowContext.table_name } }, 'Bound row context loaded');
    }

    const convForSpace = await dbGet(
      isPostgres() ? `SELECT space_id FROM conversations WHERE id = $1` : `SELECT space_id FROM conversations WHERE id = ?`,
      [conversationId]
    );

    const skillAgentRowId = agentConfig.row_id || agentConfig.id || null;
    const agentSpaceId = convForSpace?.space_id || null;
    // ADR-0056: pass agentConfig.tools so workflow-skill slugs resolve via table 1790.
    const injectedSkills = await fetchAgentSkills(
      skillAgentRowId, agentSpaceId, agentConfig.tools || agentConfig.allowed_tools || null
    );
    if (injectedSkills.length > 0) {
      apiLogger.info({ agentRowId: skillAgentRowId, skillCount: injectedSkills.length, skillNames: injectedSkills.map(s => s.name) }, 'S05: Injecting skills into agent system prompt');
    }

    let systemPrompt = await sharedBuildAgentSystemPrompt(agentConfig, {
      spaceId: agentSpaceId, conversationId, boundRow: boundRowContext,
      agentMode: agent_mode, skills: injectedSkills,
    }, 'account');

    // ADR-110 AC8: Inject conversation summaries
    try {
      const autoSummarySettings = parseAutoSummarySettings(agentConfig);
      if (autoSummarySettings.enabled && autoSummarySettings.inject_in_system) {
        const aiContext = await buildAIContext(conversationId);
        if (aiContext.systemContext) {
          const vectorSettings = parseVectorSearchSettings(agentConfig);
          if (vectorSettings.enabled && userMessage) {
            const relevantSummaries = await searchSimilarSummaries(conversationId, userMessage, {
              top_k: vectorSettings.top_k, similarity_threshold: vectorSettings.similarity_threshold,
              spaceId: convForSpace?.space_id || null,
            });
            if (relevantSummaries.length > 0) {
              const vectorContext = '\n\nRelevant past context (by semantic similarity):\n' +
                relevantSummaries.map(s => `- [similarity: ${s.similarity.toFixed(2)}] ${s.summary}`).join('\n');
              systemPrompt = vectorContext + '\n\n' + systemPrompt;
              apiLogger.info({ conversationId, matchCount: relevantSummaries.length }, 'ADR-110: Vector search injected relevant summaries');
            }
          }
          systemPrompt = aiContext.systemContext + '\n\n' + systemPrompt;
          apiLogger.info({ conversationId, summaryCount: aiContext.summaries.length }, 'ADR-110: Injected conversation summaries into system prompt');
        }
      }
    } catch (summaryErr) {
      apiLogger.warn({ err: summaryErr.message, conversationId }, 'ADR-110: Summary injection failed (non-fatal), continuing without summaries');
    }

    const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
    const senderId = await resolveAgentSenderId(agent);
    const agentDisplayName = agent.name || agent._agentConfig?.name || 'AI Agent';
    const agentIcon = agent._agentConfig?.icon || agent._agentConfig?.emoji || null;
    const agentColor = agent._agentConfig?.color || null;

    apiLogger.info({ conversationId, agentName: agent.name, senderId, agentRowId, resolved: senderId != null },
      'ADR-095: sender_id resolution complete for agent response');

    const resolved = await sharedResolveAgentProvider(agentConfig);
    const allowedTools = await resolveAllowedTools(agentConfig, convForSpace?.space_id);
    const hasTools = allowedTools.length > 0;

    if (agent_mode === 'agent' && hasTools) {
      apiLogger.info({ conversationId, agentName: agent.name, agent_mode, toolCount: allowedTools.length,
        provider: resolved.provider, model: resolved.model },
        'ADR-095: Routing to executeAgentToolLoop (agent mode with tools)');

      const responseText = await executeAgentToolLoop({
        conversationId, systemPrompt, history: formattedHistory,
        userMessage: enrichedUserMessage, agentConfig, resolved, agentRowId, senderId,
        spaceId: convForSpace?.space_id || null, userId, statusMessageId,
      });

      _finalResponseText = responseText || '';
      if (responseText) {
        logMessageSent(agentDisplayName, conversationId, `Agent tool loop responded (${responseText.length} chars)`);
      }

      _triggerAutoSummary(conversationId, agentConfig, convForSpace);

    } else {
      apiLogger.info({ conversationId, agentName: agent.name, agent_mode, hasTools },
        'ADR-095: Routing to callAgentAI (simple Q&A, no tools)');

      if (statusMessageId) {
        updateAgentStatus(statusMessageId, 'generating', 'Generating response...').catch(() => {});
      }
      const aiResponse = await callAgentAI(agent, enrichedUserMessage, formattedHistory, systemPrompt, agentConfig, { agent_mode, thinking_enabled });

      if (aiResponse && typeof aiResponse === 'object' && aiResponse.success === false) {
        apiLogger.warn({ conversationId, agentName: agent.name, error: aiResponse.error }, 'callAgentAI returned structured error');
        const errorMetadata = JSON.stringify({ agent_name: agentDisplayName, agent_icon: agentIcon, agent_color: agentColor, agent_row_id: agentRowId, error_type: aiResponse.error });
        await saveStepMessage(conversationId, {
          content: `⚠️ **Configuration Error**\n\n${aiResponse.message}\n\n_This error was logged automatically. Contact your administrator to resolve it._`,
          contentType: 'text', role: 'assistant', senderType: 'agent', agentId: agentRowId, senderId,
          modelUsed: resolved?.model || 'unknown', metadata: errorMetadata
        });
        logMessageSent(agentDisplayName, conversationId, `Agent error: ${aiResponse.error}`);
        return;
      }

      let normalizedResponse = aiResponse;
      if (typeof aiResponse === 'object' && aiResponse?.success === true && aiResponse?.content) {
        normalizedResponse = aiResponse.content;
      }
      const responseText = typeof normalizedResponse === 'object' && normalizedResponse?.text ? normalizedResponse.text : normalizedResponse;
      const thinkingText = typeof normalizedResponse === 'object' && normalizedResponse?.thinking ? normalizedResponse.thinking : null;

      if (responseText || thinkingText) {
        const messageMetadata = JSON.stringify({ agent_name: agentDisplayName, agent_icon: agentIcon, agent_color: agentColor, agent_row_id: agentRowId });

        if (thinkingText) {
          await saveStepMessage(conversationId, { content: thinkingText, contentType: 'thinking', role: 'assistant', senderType: 'agent', agentId: agentRowId, senderId, modelUsed: resolved.model, metadata: messageMetadata });
          apiLogger.info({ conversationId, agentName: agentDisplayName, thinkingLen: thinkingText.length }, 'Saved thinking block for Q&A response');
        }

        if (responseText) {
          await saveStepMessage(conversationId, { content: responseText, contentType: 'text', role: 'assistant', senderType: 'agent', agentId: agentRowId, senderId, modelUsed: resolved.model, metadata: messageMetadata });
        }

        const totalLen = (responseText?.length || 0) + (thinkingText?.length || 0);
        apiLogger.info({ conversationId, agentName: agentDisplayName, senderId, agentRowId, hasMetadata: true, hasThinking: !!thinkingText }, 'ADR-095: Agent Q&A response saved via saveStepMessage');

        _finalResponseText = responseText || '';
        logMessageSent(agentDisplayName, conversationId, `Agent responded (${totalLen} chars${thinkingText ? ', with thinking' : ''})`);
        _triggerAutoSummary(conversationId, agentConfig, convForSpace);
      } else {
        apiLogger.warn({ conversationId, agentName: agent.name }, 'callAgentAI returned empty response');
        const emptyMetadata = JSON.stringify({ agent_name: agentDisplayName, agent_icon: agentIcon, agent_color: agentColor, agent_row_id: agentRowId });
        await saveStepMessage(conversationId, {
          content: `⚠️ I received an empty response from the AI provider. This may be a temporary issue — please try again.`,
          contentType: 'text', role: 'assistant', senderType: 'agent', agentId: agentRowId, senderId,
          modelUsed: resolved?.model || 'unknown', metadata: emptyMetadata
        });
      }
    }

    if (statusMessageId && agent_mode !== 'agent') {
      finalizeAgentStatus(statusMessageId, null).catch(err =>
        apiLogger.error({ err, statusMessageId }, 'Failed to finalize agent status (Q&A path)')
      );
    }

    // ── Delegation ──
    if (_finalResponseText) {
      _handleDelegation(conversationId, _finalResponseText, agent, userId, { agent_mode, thinking_enabled, attachments, attachmentBaseUrl }, convForSpace, executeAgentResponse);
    }

    // ── Auto-update ticket status ──
    if (_finalResponseText) {
      _handleTicketStatusDirective(conversationId, _finalResponseText, agent);
    }

  } catch (err) {
    apiLogger.error({ err, conversationId, agentName: agent.name }, 'Error triggering agent response');
    try {
      const errorMetadata = JSON.stringify({ agent_name: agent.name, error_type: 'exception' });
      await saveStepMessage(conversationId, {
        content: `⚠️ **Error**\n\nAn unexpected error occurred while processing your message: ${err?.message || 'unknown error'}\n\n_The error has been logged. Please try again._`,
        contentType: 'text', role: 'assistant', senderType: 'agent', agentId: null, senderId: null,
        modelUsed: 'unknown', metadata: errorMetadata
      });
    } catch (saveErr) {
      apiLogger.error({ saveErr, conversationId }, 'Failed to save error message to chat');
    }
  }
}

export {
  executeAgentResponse, triggerAgentResponse, normalizeAgentConfig,
};
