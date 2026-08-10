/**
 * Agent Tools Service — thin wrapper
 *
 * All logic has been split into modules under ./agent-tools/.
 * This file re-exports everything to maintain backward compatibility.
 */

export { AGENT_TOOLS, toolHandlers, executeTool } from './agent-tools/index.js';
export { parseRowData } from './agent-tools/data-tools.js';
export {
  validateFilePath,
  autoBackup,
  PROJECT_ROOT,
  FS_MAX_READ_SIZE,
  FS_MAX_SEARCH_MATCHES,
  FS_MAX_SEARCH_FILES,
  FS_MAX_DIR_DEPTH,
  BLOCKED_DIRS,
  SENSITIVE_PATTERNS,
} from './agent-tools/file-tools.js';

import { AGENT_TOOLS, toolHandlers, executeTool } from './agent-tools/index.js';

export default {
  AGENT_TOOLS,
  toolHandlers,
  executeTool
};
