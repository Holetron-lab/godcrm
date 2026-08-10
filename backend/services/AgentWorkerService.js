/**
 * AgentWorkerService — thin wrapper
 *
 * All logic has been split into modules under ./agent-worker/:
 *   - constants.js — Configuration, agent mappings, slug resolution
 *   - execution.js — Ticket execution, conversation binding, context builders
 *   - polling.js   — Lifecycle, polling, ticket discovery, cleanup, status
 *   - index.js     — barrel re-export
 *
 * This file re-exports for backward compatibility.
 */

export { default, AgentWorkerService } from './agent-worker/index.js';
