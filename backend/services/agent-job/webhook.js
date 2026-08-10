/**
 * AgentJobService — Webhook Module
 *
 * handleWebhookResult — external agent session result submission.
 */

import { apiLogger } from '../../utils/logger.js';
import { saveStepMessage } from '../AgentLoopService.js';
import { setConversationProcessing } from '../chat/agent-execution-shared.js';
import { logAgentActivity } from '../AgentActivityLogger.js';
import { getJob } from './query.js';
import { completeJob, JOB_STATUS } from './shared.js';

/**
 * Handle webhook result from external agent session.
 * Called by POST /agents/jobs/:id/result endpoint.
 *
 * @param {number} jobId - Job database ID
 * @param {string} resultMessage - Agent's response text
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function handleWebhookResult(jobId, resultMessage, metadata = {}) {
  const job = await getJob(jobId);
  if (!job) {
    return { success: false, error: 'Job not found' };
  }

  if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.CANCELLED) {
    return { success: false, error: `Job already ${job.status}` };
  }

  // Save the response to the conversation
  if (resultMessage) {
    const agentName = job.agent_name || 'AI Agent';
    const messageMetadata = JSON.stringify({
      agent_name: agentName,
      agent_row_id: job.agent_row_id,
      job_id: job.id,
      source: 'webhook',
      ...metadata,
    });

    await saveStepMessage(job.conversation_id, {
      content: resultMessage,
      contentType: 'text',
      role: 'assistant',
      senderType: 'agent',
      agentId: job.agent_row_id,
      senderId: job.agent_user_id,
      modelUsed: metadata.model || null,
      metadata: messageMetadata,
    });
  }

  // Mark job completed
  await completeJob(jobId, resultMessage, metadata);

  // Clear conversation processing state
  await setConversationProcessing(job.conversation_id, false);

  // Log activity
  logAgentActivity({
    agent_id: job.agent_name || 'unknown',
    action: 'task_completed',
    details: `Job ${jobId} completed via webhook (${resultMessage?.length || 0} chars)`,
    success: true,
    conversation_id: job.conversation_id,
  });

  return { success: true };
}
