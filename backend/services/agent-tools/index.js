/**
 * Agent Tools — barrel re-export
 *
 * Maintains backward compatibility: any import from the old
 * AgentToolsService.js will resolve to the same named exports.
 */

export { AGENT_TOOLS } from './tool-definitions.js';
export { toolHandlers, executeTool } from './executor.js';

// Re-export utilities that other modules may depend on
export { parseRowData } from './data-tools.js';
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
} from './file-tools.js';

// Default export for `import AgentToolsService from '...'` style
import { AGENT_TOOLS } from './tool-definitions.js';
import { toolHandlers, executeTool } from './executor.js';

export default {
  AGENT_TOOLS,
  toolHandlers,
  executeTool
};
