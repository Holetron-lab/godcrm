/**
 * AgentJobService — Async Agent Job Queue
 *
 * Strategy B implementation: Asynchronous agent dispatch via job queue.
 *
 * Split into modules:
 *   - shared.js     — constants, helpers, job status update functions
 *   - create.js     — createAndDispatchJob, processJobLocally
 *   - query.js      — getJob, getJobByUuid, getPendingJobs, etc.
 *   - webhook.js    — handleWebhookResult
 *   - lifecycle.js  — cancelJob, recoverStuckJobs, shutdown state
 *
 * @see ADR-093: Chat API Unification
 * @see Migration 034: agent_jobs table
 */

export { createAndDispatchJob } from './create.js';
export { getJob, getJobByUuid, getPendingJobs, getJobsForConversation, getStalledJobs } from './query.js';
export { handleWebhookResult } from './webhook.js';
export { cancelJob, recoverStuckJobs, setShuttingDown, isShuttingDown } from './lifecycle.js';
export { startJobWatchdog, stopJobWatchdog } from './watchdog.js';
export { JOB_STATUS, JOB_TIMEOUT_MS, mapTodoStatus } from './shared.js';

import { createAndDispatchJob } from './create.js';
import { getJob, getJobByUuid, getPendingJobs, getJobsForConversation, getStalledJobs } from './query.js';
import { handleWebhookResult } from './webhook.js';
import { cancelJob, recoverStuckJobs } from './lifecycle.js';
import { JOB_STATUS } from './shared.js';

export default {
  createAndDispatchJob,
  getJob,
  getJobByUuid,
  getPendingJobs,
  getJobsForConversation,
  getStalledJobs,
  handleWebhookResult,
  cancelJob,
  recoverStuckJobs,
  JOB_STATUS,
};
