/**
 * ADR-116 / ADR-117: Structured Invocation Token Parsers
 *
 * Centralized mention and command parsing for the chat system.
 * Separates INVOCATION (triggers agent delegation) from REFERENCE (display only).
 *
 * Token formats:
 *   <<@slug>>  — mention invocation (triggers agent)
 *   <</slug>>  — slash invocation (triggers agent)
 *   @slug      — mention reference (display only, no trigger)
 *   /slug      — command reference (display only, no trigger)
 *
 * Used by:
 *   - backend/routes/v3/chat.js — agent delegation + user message handling
 *   - Frontend display layer — rendering pills/chips
 */

/**
 * Parse @mentions from message content (legacy, catches ALL @-prefixed words).
 * Used for backward-compatible user input processing.
 * @param {string} content - Message content
 * @returns {string[]} Array of mentioned usernames (without @)
 */
export function parseMentions(content) {
  if (!content || typeof content !== 'string') return [];
  const mentionPattern = /@([a-z0-9_-]+)/gi;
  const matches = content.match(mentionPattern) || [];
  return matches.map(m => m.substring(1).toLowerCase());
}

/**
 * ADR-117: Parse explicit agent delegation syntax from text.
 * Only <<@slug>> triggers delegation. Plain @mentions are references only.
 * @param {string} content - Message text
 * @returns {string[]} Array of agent slugs to delegate to
 */
export function parseDelegations(content) {
  if (!content || typeof content !== 'string') return [];
  // Strip code blocks and inline code to avoid false matches when text
  // merely discusses the <<@slug>> syntax (e.g. in reasoning/docs).
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`]+`/g, '');          // inline code spans
  const delegationPattern = /<<@([a-z0-9_-]+)>>/gi;
  const matches = [];
  let match;
  while ((match = delegationPattern.exec(stripped)) !== null) {
    matches.push(match[1].toLowerCase());
  }
  return matches;
}

/**
 * ADR-116: Parse INVOCATION mentions — only <<@slug>> triggers delegation.
 * Alias for parseDelegations() with unified naming convention.
 * @param {string} content
 * @returns {string[]} Array of slugs (lowercase)
 */
export function parseInvocationMentions(content) {
  return parseDelegations(content);
}

/**
 * ADR-116: Parse INVOCATION slash commands — only <</slug>> triggers delegation.
 * Supports optional command index: <</slug/N>> where N picks from main_instruction JSON array.
 * @param {string} content
 * @returns {Array<{slug: string, commandIndex: number|null}>} Array of parsed commands
 */
export function parseInvocationCommands(content) {
  if (!content || typeof content !== 'string') return [];
  // Strip code blocks and inline code to avoid false matches
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');
  const pattern = /<<\/([a-z][a-z0-9_-]*)(?:\/(\d+))?>>/gi;
  const matches = [];
  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    matches.push({
      slug: match[1].toLowerCase(),
      commandIndex: match[2] != null ? parseInt(match[2], 10) : null,
    });
  }
  return matches;
}

/**
 * ADR-116: Parse REFERENCE mentions — @slug outside of <<@...>> tokens.
 * Used for display highlighting only, NOT for delegation.
 * @param {string} content
 * @returns {string[]}
 */
export function parseReferenceMentions(content) {
  if (!content || typeof content !== 'string') return [];
  // Remove all invocation tokens first
  const cleaned = content.replace(/<<@[a-z0-9_-]+>>/gi, '');
  const pattern = /@([a-z0-9_-]+)/gi;
  const matches = cleaned.match(pattern) || [];
  return matches.map(m => m.substring(1).toLowerCase());
}

/**
 * ADR-116: Parse REFERENCE slash commands — /slug outside of <</...>> tokens.
 * Used for display highlighting only, NOT for delegation.
 * @param {string} content
 * @returns {string[]}
 */
export function parseReferenceCommands(content) {
  if (!content || typeof content !== 'string') return [];
  // Remove all invocation tokens first
  const cleaned = content.replace(/<<\/[a-z][a-z0-9_-]*>>/gi, '');
  const pattern = /(?:^|\s)\/([a-z][a-z0-9_-]*)(?=\s|$)/gim;
  const matches = [];
  let match;
  while ((match = pattern.exec(cleaned)) !== null) {
    matches.push(match[1].toLowerCase());
  }
  return matches;
}

/**
 * ADR-069: Parse /commands from message content (legacy, for user input).
 * Only matches /command when preceded by start-of-string or whitespace,
 * and followed by whitespace or end-of-string.
 * @param {string} content - Message content
 * @returns {string[]} Array of agent names (without /)
 */
export function parseAgentCommands(content) {
  if (!content || typeof content !== 'string') return [];
  const commandPattern = /(?:^|\s)\/([a-z][a-z0-9_-]*)(?=\s|$)/gim;
  const matches = [];
  let match;
  while ((match = commandPattern.exec(content)) !== null) {
    matches.push(match[1].toLowerCase());
  }
  return matches;
}
