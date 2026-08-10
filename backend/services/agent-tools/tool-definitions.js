/**
 * Tool Definitions — AGENT_TOOLS array
 *
 * OpenAI function-calling schema for every tool available to AI agents.
 *
 * The definitions were split by category into `./tool-definitions/*.js` in
 * 2026-04 to stay under the 800-LOC per-file ceiling. This file re-exports
 * the assembled list so existing callers (`./services/agent-tools/index.js`,
 * `./services/agent-tools/misc-tools.js`, `backend/mcp-server.js`) keep
 * working unchanged.
 */

export { AGENT_TOOLS } from './tool-definitions/index.js';
