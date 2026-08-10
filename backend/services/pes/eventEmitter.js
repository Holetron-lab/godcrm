// ============================================================
// PES Event Emitter — Auto-fires PES events from CRM actions
// ============================================================
// Import and call these functions from other CRM services
// to automatically notify PES about system events
// ============================================================

import { pushEvent } from './bridge.js';
import { apiLogger } from '../../utils/logger.js';

/**
 * Notify PES that a ticket was created
 */
export function pesTicketCreated(ticketId, title, priority) {
  return pushEvent('ticket_created', { ticketId, title, priority });
}

/**
 * Notify PES that a ticket was resolved
 */
export function pesTicketResolved(ticketId, title, resolvedBy) {
  return pushEvent('ticket_resolved', { ticketId, title, resolvedBy });
}

/**
 * Notify PES that an agent completed its job
 */
export function pesAgentCompleted(agentName, jobId, result) {
  return pushEvent('agent_completed', { agentName, jobId, result });
}

/**
 * Notify PES that an agent failed
 */
export function pesAgentFailed(agentName, jobId, errorMsg) {
  return pushEvent('agent_failed', { agentName, jobId, error: errorMsg });
}

/**
 * Notify PES of deployment
 */
export function pesDeployment(success, details) {
  return pushEvent(success ? 'deployment_success' : 'deployment_failed', details);
}

/**
 * Notify PES of user login
 */
export function pesUserLogin(userId, userName) {
  return pushEvent('user_login', { userId, userName });
}

/**
 * Notify PES of user logout
 */
export function pesUserLogout(userId, userName) {
  return pushEvent('user_logout', { userId, userName });
}

/**
 * Notify PES of error spike
 */
export function pesErrorSpike(errorCount, timeWindow, details) {
  return pushEvent('error_spike', { errorCount, timeWindow, details });
}

/**
 * Send custom event to PES
 */
export function pesCustomEvent(data) {
  return pushEvent('custom', data);
}
