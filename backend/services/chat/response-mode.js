/**
 * ADR-091 Phase 2 / Ticket #41161 (AC17): Response Mode Utilities
 *
 * Provides keyword-based relevance checking for agents with
 * `response_mode: 'topic_only'`. When a group conversation has multiple
 * sub-agents, a topic_only agent should only respond when the incoming
 * message appears to be about its area of expertise.
 *
 * Approach: simple keyword extraction + case-insensitive matching.
 * No AI/ML -- just stop-word filtering and substring comparison.
 */

/**
 * Common English stop words that carry no topical signal.
 * Kept as a module-level Set for reuse across calls.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'into',
  'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your', 'i', 'my', 'we', 'our',
  'they', 'their', 'he', 'she', 'him', 'her', 'his', 'if', 'then', 'than', 'when', 'where',
  'how', 'what', 'which', 'who', 'whom', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'just', 'also',
  // Additional generic words that appear in many agent configs
  'agent', 'assistant', 'help', 'respond', 'please', 'always', 'make', 'like',
  'over', 'take', 'very', 'still', 'using', 'about', 'after', 'been', 'there',
  'out', 'one', 'get', 'set', 'use', 'new', 'way', 'any'
]);

/**
 * Extract meaningful keywords from a block of text.
 *
 * Rules:
 * - Strips non-alphanumeric characters (keeps Unicode letters and digits)
 * - Splits on whitespace
 * - Filters out words shorter than 3 characters
 * - Filters out common stop words
 * - Returns de-duplicated, lowercased keywords
 *
 * @param {string} text - Raw text to extract keywords from
 * @returns {string[]} Array of unique, lowercased keywords
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];

  return [...new Set(
    text
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
  )];
}

/**
 * Determine whether an incoming message is relevant to an agent's area of
 * expertise. Designed for agents configured with `response_mode: 'topic_only'`.
 *
 * The function collects text from the agent's `name`, `description`,
 * `system_prompt`, `main_instructions`, and `tags`, extracts meaningful
 * keywords, and checks whether the message content contains at least one
 * matching keyword (case-insensitive substring match).
 *
 * @param {string} messageContent - The user's message text
 * @param {Object} agentConfig - Agent configuration object from the AI Agents table
 * @param {string} [agentConfig.name] - Agent display name
 * @param {string} [agentConfig.description] - Agent description / purpose
 * @param {string} [agentConfig.system_prompt] - System prompt text
 * @param {string} [agentConfig.main_instructions] - Main instructions text
 * @param {string|string[]} [agentConfig.tags] - Tags (string or array)
 * @returns {boolean} `true` if the message appears relevant to this agent
 */
function isMessageRelevantToAgent(messageContent, agentConfig) {
  if (!messageContent || typeof messageContent !== 'string') return false;
  if (!agentConfig || typeof agentConfig !== 'object') return false;

  // Collect keyword sources from agent config
  const { name, description, system_prompt, main_instructions, tags } = agentConfig;

  const sources = [name, description, system_prompt, main_instructions, tags].filter(Boolean);

  if (sources.length === 0) return false;

  // Normalise each source (tags may be an array) and join into one text blob
  const configText = sources
    .map(source => (Array.isArray(source) ? source.join(' ') : String(source)))
    .join(' ');

  const keywords = extractKeywords(configText);

  if (keywords.length === 0) return false;

  // Check if message content matches any keyword (case-insensitive)
  const lowerContent = messageContent.toLowerCase();
  const matchScore = keywords.filter(kw => lowerContent.includes(kw)).length;

  // Threshold: at least 1 keyword match
  return matchScore >= 1;
}

export { isMessageRelevantToAgent, extractKeywords, STOP_WORDS };
export default isMessageRelevantToAgent;
