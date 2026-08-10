/**
 * Tickets API Routes — ADR-098: Unified Execution Ecosystem
 *
 * Specialized ticket endpoints with state machine validation,
 * separate from generic row CRUD (PUT /tables/:tableId/rows/:rowId).
 *
 * Phase 0 (4 states): backlog, in_progress, review, done
 * Phase 1 (7 states): + assigned, control, rejected
 *
 * Endpoints:
 *   PATCH  /tickets/:id/status        — Change ticket state (state machine validated)
 *   GET    /tickets/:id               — Get ticket with allowed transitions
 *   POST   /tickets/dispatch           — Dispatch single subtask
 *   POST   /tickets/dispatch-chain     — Dispatch batch of linked subtasks
 *   GET    /tickets/chains/:chainId    — Get chain progress
 *   GET    /tickets/agents/me/tasks    — Get calling agent's pending tasks
 *   POST   /tickets/:id/message        — Send message in ticket's bound chat
 *   POST   /tickets/:id/invoke-agent  — Invoke assigned agent to work on ticket (ADR-077 Task #12)
 *   POST   /tickets/:id/seal           — TOTP-act ticket seal (ADR-0002 §8 Phase 4)
 *   POST   /tickets/:id/unseal         — TOTP-act ticket unseal with reason (ADR-0002 §8 Phase 4)
 */

import { Router } from 'express';

import registerCrudRoutes from './crud.js';
import registerDispatchRoutes from './dispatch.js';
import registerExecutionRoutes from './execution.js';
import registerChainsRoutes from './chains.js';
import registerSealRoutes from './seal.js';

// Re-export named exports for backward compatibility
export { STATE_MAP, STATE_NAMES, TRANSITIONS, SUPERVISOR_AGENT_IDS, resolveState, parseStatusDirective } from './shared.js';

const router = Router();

registerCrudRoutes(router);
registerDispatchRoutes(router);
registerExecutionRoutes(router);
registerChainsRoutes(router);
registerSealRoutes(router); // ADR-0002 §8 Phase 4 — TOTP-act seal/unseal

export default router;
