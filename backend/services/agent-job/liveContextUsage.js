/**
 * In-memory store for live context window usage during agent execution.
 * Updated by agent loop after each API call, read by SSE poller.
 * Keyed by conversation_id.
 */

const store = new Map();

// Common context window sizes by model prefix
const CONTEXT_WINDOWS = {
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'claude-opus-4-6': 200000,
  'claude-haiku-4': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 128000,
  'gpt-3.5': 16385,
  'o1': 200000,
  'o3': 200000,
  'o4-mini': 200000,
  'gemini': 1000000,
  'deepseek': 64000,
};

/**
 * Guess context window size from model name.
 */
function guessContextWindow(model) {
  if (!model) return 200000;
  const lower = model.toLowerCase();
  for (const [prefix, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (lower.includes(prefix)) return size;
  }
  return 200000; // default
}

/**
 * Update live context usage for a conversation.
 * @param {number} conversationId
 * @param {{ prompt_tokens: number, completion_tokens: number, model?: string, iteration?: number, maxIterations?: number }} data
 */
export function setContextUsage(conversationId, data) {
  const contextWindow = data.context_window || guessContextWindow(data.model);
  store.set(Number(conversationId), {
    prompt_tokens: data.prompt_tokens || 0,
    completion_tokens: data.completion_tokens || 0,
    total_tokens: (data.prompt_tokens || 0) + (data.completion_tokens || 0),
    context_window: contextWindow,
    model: data.model || null,
    iteration: data.iteration || 0,
    max_iterations: data.maxIterations || data.max_iterations || 0,
    ts: Date.now(),
  });
}

/**
 * Get live context usage for a conversation.
 * Returns null if no data or data is stale (>60s).
 * @param {number} conversationId
 * @returns {Object|null}
 */
export function getContextUsage(conversationId) {
  const entry = store.get(Number(conversationId));
  if (!entry) return null;
  // Stale after 60 seconds
  if (Date.now() - entry.ts > 60000) {
    store.delete(Number(conversationId));
    return null;
  }
  return entry;
}

/**
 * Clear live context usage (call when agent finishes).
 * @param {number} conversationId
 */
export function clearContextUsage(conversationId) {
  store.delete(Number(conversationId));
}
