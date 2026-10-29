import { withTransactionAsync } from '../../database/connection.js';

// Serialize admission across server processes, not just within one JS runtime.
// The conversation row always exists; locking it also covers the first job.
export async function reserveAgentJob({ conversationId, agentRowId, agentUserId, message }, create) {
  if (!agentRowId && !agentUserId) throw new Error('Agent identity is required');
  return withTransactionAsync(async tx => {
    const conversation = await tx.get('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
    if (!conversation) throw new Error('Conversation not found');
    const active = await tx.get(`SELECT id, job_id FROM agent_jobs
      WHERE conversation_id = $1 AND status IN ('pending', 'processing')
        AND (agent_row_id = $2 OR ($2::bigint IS NULL AND agent_user_id = $3))
      ORDER BY id LIMIT 1 FOR UPDATE`, [conversationId, agentRowId, agentUserId]);
    if (!active) return create(tx);
    if (message) await tx.run(`UPDATE agent_jobs SET context = jsonb_set(COALESCE(context::jsonb, '{}'::jsonb),
      '{pending_invocations}', COALESCE(context::jsonb->'pending_invocations', '[]'::jsonb) || $1::jsonb)
      WHERE id = $2`, [JSON.stringify([message]), active.id]);
    return { id: active.id, jobId: active.job_id, skipped: true, reason: 'active_job' };
  });
}

// Both the MCP response and worker completion take this row lock. A message
// is either delivered to the running CLI or picked up by its continuation.
export async function takeJobMessages(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return [];
  return withTransactionAsync(async tx => {
    const row = await tx.get('SELECT status, context FROM agent_jobs WHERE id = $1 FOR UPDATE', [jobId]);
    if (!row || !['pending', 'processing'].includes(row.status)) return [];
    const context = typeof row.context === 'string' ? JSON.parse(row.context) : row.context;
    const messages = context?.pending_invocations || [];
    if (messages.length) await tx.run("UPDATE agent_jobs SET context = context::jsonb - 'pending_invocations' WHERE id = $1", [jobId]);
    return messages;
  });
}

export async function finishOrContinueJob(jobId, resultMessage, metadata) {
  return withTransactionAsync(async tx => {
    const row = await tx.get('SELECT status, context FROM agent_jobs WHERE id = $1 FOR UPDATE', [jobId]);
    if (!row || !['pending', 'processing'].includes(row.status)) return [];
    const context = typeof row.context === 'string' ? JSON.parse(row.context) : row.context;
    const messages = context?.pending_invocations || [];
    if (messages.length) {
      await tx.run("UPDATE agent_jobs SET context = context::jsonb - 'pending_invocations' WHERE id = $1", [jobId]);
      return messages;
    }
    await tx.run(`UPDATE agent_jobs SET status = 'completed', result_message = $1,
      result_metadata = $2, completed_at = NOW() WHERE id = $3`,
    [resultMessage, JSON.stringify(metadata), jobId]);
    return [];
  });
}
