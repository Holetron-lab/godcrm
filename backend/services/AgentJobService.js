/**
 * AgentJobService — Async Agent Job Queue
 *
 * Split into modules under ./agent-job/:
 *   - shared.js     — constants, helpers, job status update functions
 *   - create.js     — createAndDispatchJob, processJobLocally
 *   - query.js      — getJob, getJobByUuid, getPendingJobs, etc.
 *   - webhook.js    — handleWebhookResult
 *   - lifecycle.js  — cancelJob, recoverStuckJobs, shutdown state
 *   - index.js      — barrel re-export
 */

export {
  default,
  createAndDispatchJob,
  getJob,
  getJobByUuid,
  getPendingJobs,
  getJobsForConversation,
  getStalledJobs,
  handleWebhookResult,
  cancelJob,
  recoverStuckJobs,
  setShuttingDown,
  isShuttingDown,
  startJobWatchdog,
  stopJobWatchdog,
  JOB_STATUS,
  JOB_TIMEOUT_MS,
  mapTodoStatus,
} from './agent-job/index.js';
