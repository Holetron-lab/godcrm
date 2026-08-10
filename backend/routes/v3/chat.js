/**
 * Chat routes — thin re-export wrapper.
 * All logic has been refactored into ./chat/ modules.
 * This file preserves backward compatibility for server.js and any other importers.
 */

// Default export: the Express router
export { default } from './chat/index.js';

// Named exports (backward compatibility with original line 1215)
export {
  MAX_DELEGATION_DEPTH, MAX_MENTIONS_PER_RESPONSE,
  _activeDelegationChains, getDelegationChain, clearDelegationChain,
  parseMentions, parseDelegations,
  parseInvocationMentions, parseInvocationCommands,
  parseReferenceMentions, parseReferenceCommands,
} from './chat/index.js';
