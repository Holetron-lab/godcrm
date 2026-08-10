/**
 * AgentJobService — Query Module
 *
 * getJob, getJobByUuid, getPendingJobs, getJobsForConversation, getStalledJobs.
 */

import { dbGet, dbAll } from '../../database/connection.js';

/**
 * Get a job by its database ID
 */
export async function getJob(jobId) {
  return dbGet(
    `SELECT * FROM agent_jobs WHERE id = $1`,
    [jobId]
  );
}

/**
 * Get a job by its UUID
 */
export async function getJobByUuid(jobUuid) {
  return dbGet(
    `SELECT * FROM agent_jobs WHERE job_id = $1`,
    [jobUuid]
  );
}

/**
 * Get all pending jobs (for worker polling)
 */
export async function getPendingJobs(limit = 10) {
  return dbAll(
    `SELECT * FROM agent_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
}

/**
 * Get all jobs for a conversation
 */
export async function getJobsForConversation(conversationId) {
  return dbAll(
    `SELECT * FROM agent_jobs WHERE conversation_id = $1 ORDER BY created_at DESC`,
    [conversationId]
  );
}

/**
 * Check if the conversation's processing has been cancelled.
 * Used by agent loop to detect user-initiated stop between iterations.
 * Returns true if the conversation is no longer marked as processing
 * (cancelJob sets is_processing=false).
 */
export async function isConversationCancelled(conversationId) {
  const row = await dbGet(
    `SELECT is_processing FROM conversations WHERE id = $1`,
    [conversationId]
  );
  if (!row) return true;
  return !row.is_processing && row.is_processing !== undefined;
}

/**
 * Get stalled jobs (processing but past timeout)
 */
export async function getStalledJobs() {
  return dbAll(
    `SELECT * FROM agent_jobs WHERE status = 'processing' AND timeout_at < NOW()`
  );
}
