// tickets.js — thin re-export to split modules
export { default } from './tickets/index.js';

// Named exports for testing (backward compatibility)
export { STATE_MAP, STATE_NAMES, TRANSITIONS, SUPERVISOR_AGENT_IDS, resolveState, parseStatusDirective } from './tickets/index.js';
