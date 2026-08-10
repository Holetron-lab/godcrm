/**
 * AgentWorkerService — barrel re-export
 *
 * Maintains backward compatibility: default export is the service singleton,
 * named export { AgentWorkerService } also available.
 */

import AgentWorkerService from './polling.js';

export default AgentWorkerService;
export { AgentWorkerService };
