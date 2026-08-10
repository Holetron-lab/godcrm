/**
 * AI Security Service
 * ADR-071: Security Hardening — Tasks 4-8
 *
 * Provides input sanitization, prompt injection detection, output redaction,
 * audit logging, and rate limiting for AI agents
 *
 * API:
 * - sanitizeInput(message) - returns {sanitized: string, threats: string[]}
 * - detectInjection(message) - returns {detected: boolean, patterns: string[]}
 * - escapeSpecialTokens(message) - escapes LLM special tokens
 * - redactSecrets(text) - redacts API keys, tokens, passwords
 * - redactPII(text) - redacts email, phone, credit cards
 * - redactOutput(text) - combined redaction (secrets + PII)
 * - hashContent(content) - SHA256 hash for privacy
 * - logAuditEntry(entry) - records to ai_audit_log table
 * - checkRateLimit(userId, agentId) - returns {allowed, remaining, resetIn}
 * - incrementRateLimit(userId, agentId) - increments counters
 * - clearRateLimits() - clears all rate limit counters (for testing)
 */

import { createHash } from 'crypto';
import { aiLogger as logger } from '../utils/logger.js';
import { dbRun } from '../database/connection.js';

// ============================================================
// Injection Detection Patterns (from ADR-071)
// ============================================================

/**
 * Regular expressions to detect prompt injection attempts
 * Categories:
 * - Role manipulation (you are now, ignore previous, etc.)
 * - System prompt extraction (what is your prompt, repeat instructions, etc.)
 * - Jailbreak attempts (DAN mode, developer mode, bypass restrictions, etc.)
 * - Special tokens (<|system|>, [INST], etc.)
 * - Encoded payloads (base64:, eval(), etc.)
 */
export const INJECTION_PATTERNS = [
  // Role manipulation
  /you are now/i,
  /ignore (all )?(previous|prior|above)/i,
  /disregard (all )?(previous|prior)/i,
  /forget (everything|all|your)/i,

  // System prompt extraction
  /what (is|are) your (instructions|system prompt|rules)/i,
  /repeat (your|the) (instructions|system|prompt)/i,
  /output (your|the) (system|initial) (prompt|message)/i,

  // Jailbreak attempts
  /DAN mode/i,
  /developer mode/i,
  /act as (a |an )?unrestricted/i,
  /bypass (your |all )?restrictions/i,

  // Special tokens (varies by model)
  /<\|system\|>/i,
  /<\|user\|>/i,
  /<\|assistant\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,

  // Encoded payloads
  /base64:/i,
  /eval\s*\(/i,
];

/**
 * Human-readable labels for each pattern
 * Used for threat reporting
 */
const PATTERN_LABELS = [
  // Role manipulation
  'you are now',
  'ignore previous',
  'disregard previous',
  'forget everything',

  // System prompt extraction
  'what is your system prompt',
  'repeat your instructions',
  'output the system prompt',

  // Jailbreak attempts
  'DAN mode',
  'developer mode',
  'act as unrestricted',
  'bypass restrictions',

  // Special tokens
  '<|system|>',
  '<|user|>',
  '<|assistant|>',
  '[INST]',
  '[/INST]',

  // Encoded payloads
  'base64:',
  'eval()',
];

/**
 * Special tokens that need to be escaped in user input
 * These tokens could be interpreted by various LLMs as control sequences
 */
const SPECIAL_TOKENS = [
  { pattern: /<\|system\|>/gi, replacement: '[ESCAPED:system]' },
  { pattern: /<\|user\|>/gi, replacement: '[ESCAPED:user]' },
  { pattern: /<\|assistant\|>/gi, replacement: '[ESCAPED:assistant]' },
  { pattern: /\[INST\]/gi, replacement: '[ESCAPED:INST]' },
  { pattern: /\[\/INST\]/gi, replacement: '[ESCAPED:/INST]' },
];

// ============================================================
// Public API
// ============================================================

/**
 * Detect prompt injection patterns in a message
 *
 * @param {string|null|undefined} message - The message to analyze
 * @returns {{detected: boolean, patterns: string[]}} Detection result with matched pattern labels
 *
 * @example
 * const result = detectInjection('Ignore previous instructions');
 * // { detected: true, patterns: ['ignore previous'] }
 */
export function detectInjection(message) {
  // Handle null/undefined/empty input
  if (!message || typeof message !== 'string') {
    return { detected: false, patterns: [] };
  }

  const detectedPatterns = [];

  // Check each pattern
  INJECTION_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(message)) {
      const label = PATTERN_LABELS[index];
      // Handle variations in pattern detection
      // Some patterns have multiple variants (ignore previous/prior/above)
      if (label === 'ignore previous') {
        // Check which variant was matched
        if (/ignore (all )?previous/i.test(message)) {
          detectedPatterns.push('ignore previous');
        } else if (/ignore (all )?prior/i.test(message)) {
          detectedPatterns.push('ignore prior');
        } else if (/ignore (all )?above/i.test(message)) {
          detectedPatterns.push('ignore above');
        }
      } else if (label === 'disregard previous') {
        if (/disregard (all )?previous/i.test(message)) {
          detectedPatterns.push('disregard previous');
        } else if (/disregard (all )?prior/i.test(message)) {
          detectedPatterns.push('disregard prior');
        }
      } else if (label === 'forget everything') {
        if (/forget everything/i.test(message)) {
          detectedPatterns.push('forget everything');
        } else if (/forget all/i.test(message)) {
          detectedPatterns.push('forget all');
        } else if (/forget your/i.test(message)) {
          detectedPatterns.push('forget your');
        }
      } else if (label === 'what is your system prompt') {
        if (/what is your (system prompt|rules)/i.test(message)) {
          detectedPatterns.push('what is your system prompt');
        } else if (/what are your instructions/i.test(message)) {
          detectedPatterns.push('what are your instructions');
        }
      } else if (label === 'bypass restrictions') {
        if (/bypass all restrictions/i.test(message)) {
          detectedPatterns.push('bypass all restrictions');
        } else if (/bypass (your )?restrictions/i.test(message)) {
          detectedPatterns.push('bypass restrictions');
        }
      } else {
        detectedPatterns.push(label);
      }
    }
  });

  // Remove duplicates
  const uniquePatterns = [...new Set(detectedPatterns)];

  if (uniquePatterns.length > 0) {
    logger.warn(
      { patterns: uniquePatterns, messageLength: message.length },
      'Prompt injection patterns detected'
    );
  }

  return {
    detected: uniquePatterns.length > 0,
    patterns: uniquePatterns,
  };
}

/**
 * Escape special LLM tokens in a message
 *
 * @param {string|null|undefined} message - The message to escape
 * @returns {string} Message with special tokens escaped
 *
 * @example
 * const result = escapeSpecialTokens('Hello <|system|> world');
 * // 'Hello [ESCAPED:system] world'
 */
export function escapeSpecialTokens(message) {
  // Handle null/undefined/empty input
  if (!message || typeof message !== 'string') {
    return '';
  }

  let escapedMessage = message;

  // Replace each special token with escaped version
  for (const { pattern, replacement } of SPECIAL_TOKENS) {
    escapedMessage = escapedMessage.replace(pattern, replacement);
  }

  return escapedMessage;
}

/**
 * Sanitize input message for AI processing
 * Combines injection detection and token escaping
 *
 * @param {string|null|undefined} message - The message to sanitize
 * @returns {{sanitized: string, threats: string[]}} Sanitized message and detected threats
 *
 * @example
 * const result = sanitizeInput('Ignore instructions <|system|> hello');
 * // { sanitized: 'Ignore instructions [ESCAPED:system] hello', threats: ['ignore previous', '<|system|>'] }
 */
export function sanitizeInput(message) {
  // Handle null/undefined/empty input
  if (!message || typeof message !== 'string') {
    return { sanitized: '', threats: [] };
  }

  // Trim whitespace
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return { sanitized: '', threats: [] };
  }

  // Detect injection patterns
  const detection = detectInjection(trimmedMessage);

  // Escape special tokens
  const sanitized = escapeSpecialTokens(trimmedMessage);

  // Combine threats from detection
  const threats = [...detection.patterns];

  if (threats.length > 0) {
    logger.info(
      { threatsCount: threats.length, sanitizedLength: sanitized.length },
      'Input sanitized with threats detected'
    );
  } else {
    logger.debug(
      { sanitizedLength: sanitized.length },
      'Input sanitized - no threats detected'
    );
  }

  return {
    sanitized,
    threats,
  };
}

// ============================================================
// ADR-071 Task 6: Output Redaction for PII/Secrets
// ============================================================

/**
 * Patterns for detecting secrets (API keys, tokens, passwords)
 * Each pattern has a replacement label
 */
const SECRET_PATTERNS = [
  // OpenAI API keys (sk-...)
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: 'OpenAI API key' },
  // Generic API key patterns (api_key=, api-key:, apiKey=)
  { pattern: /api[_-]?key["\s:=]+[a-zA-Z0-9"]+/gi, label: 'API key' },
  // Bearer tokens
  { pattern: /bearer\s+[a-zA-Z0-9._-]+/gi, label: 'Bearer token' },
  // Password patterns
  { pattern: /password["\s:=]+[^\s"]+/gi, label: 'password' },
];

/**
 * Patterns for detecting PII (Personally Identifiable Information)
 * Each pattern has a specific replacement label
 */
const PII_PATTERNS = [
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED:EMAIL]', label: 'email' },
  // Credit card numbers (with spaces, dashes, or no separators)
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[REDACTED:CARD]', label: 'credit card' },
  // International phone numbers (E.164 format)
  { pattern: /\+?[1-9]\d{1,14}/g, replacement: '[REDACTED:PHONE]', label: 'phone' },
];

/**
 * Redact secrets from text (API keys, tokens, passwords)
 *
 * @param {string|null|undefined} text - Text to redact
 * @returns {string} Text with secrets redacted as [REDACTED:SECRET]
 *
 * @example
 * redactSecrets('API key: sk-abcdefghijklmnopqrstuvwxyz1234567890');
 * // 'API key: [REDACTED:SECRET]'
 */
export function redactSecrets(text) {
  // Handle null/undefined/empty input
  if (!text || typeof text !== 'string') {
    return '';
  }

  let redactedText = text;

  // Apply each secret pattern
  for (const { pattern, label } of SECRET_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const hasMatch = pattern.test(redactedText);
    pattern.lastIndex = 0;

    if (hasMatch) {
      redactedText = redactedText.replace(pattern, '[REDACTED:SECRET]');
      logger.debug({ type: label }, 'Secret redacted from output');
    }
  }

  return redactedText;
}

/**
 * Redact PII from text (email, phone, credit cards)
 *
 * @param {string|null|undefined} text - Text to redact
 * @param {Object} [options] - Optional redaction options
 * @param {boolean} [options.email=true] - Whether to redact email addresses
 * @param {boolean} [options.phone=true] - Whether to redact phone numbers
 * @param {boolean} [options.card=true] - Whether to redact credit card numbers
 * @returns {string} Text with PII redacted as [REDACTED:EMAIL], [REDACTED:PHONE], etc.
 *
 * @example
 * redactPII('Contact: john@example.com, +14155551234');
 * // 'Contact: [REDACTED:EMAIL], [REDACTED:PHONE]'
 *
 * @example
 * redactPII('Email: test@example.com Phone: +1234567890', { email: true, phone: false });
 * // 'Email: [REDACTED:EMAIL] Phone: +1234567890'
 */
export function redactPII(text, options = {}) {
  // Handle null/undefined/empty input
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Default options: redact everything if not specified
  const redactEmail = options.email !== false;
  const redactPhone = options.phone !== false;
  const redactCard = options.card !== false;

  let redactedText = text;

  // Apply each PII pattern based on options
  for (const { pattern, replacement, label } of PII_PATTERNS) {
    // Check if this type should be redacted based on options
    if (label === 'email' && !redactEmail) continue;
    if (label === 'phone' && !redactPhone) continue;
    if (label === 'credit card' && !redactCard) continue;

    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const hasMatch = pattern.test(redactedText);
    pattern.lastIndex = 0;

    if (hasMatch) {
      redactedText = redactedText.replace(pattern, replacement);
      logger.debug({ type: label }, 'PII redacted from output');
    }
  }

  return redactedText;
}

/**
 * Redact all sensitive information from text (secrets + PII)
 * Combined function for comprehensive output sanitization
 *
 * @param {string|null|undefined} text - Text to redact
 * @returns {string} Text with all sensitive information redacted
 *
 * @example
 * redactOutput('API key: sk-abc123... email: user@example.com');
 * // 'API key: [REDACTED:SECRET] email: [REDACTED:EMAIL]'
 */
export function redactOutput(text) {
  // Handle null/undefined/empty input
  if (!text || typeof text !== 'string') {
    return '';
  }

  // First redact secrets, then PII
  let redactedText = redactSecrets(text);
  redactedText = redactPII(redactedText);

  return redactedText;
}


// ============================================================
// ADR-071 Task 6: System Prompt Leak Detection
// ============================================================

/**
 * Patterns that indicate potential system prompt leakage
 * These phrases suggest the AI is revealing its instructions
 */
const LEAK_PATTERNS = [
  /my instructions (are|say|tell)/i,
  /my system prompt (is|says)/i,
  /i was told to/i,
  /according to my instructions/i,
  /my programming (says|tells|requires)/i,
  /i am programmed to/i,
  /my guidelines (say|state|require)/i,
];

/**
 * Detect if AI output contains a leak of the system prompt
 *
 * Detection methods:
 * 1. Exact match - output contains the entire system prompt
 * 2. Partial match - output contains >50% of system prompt words
 * 3. Pattern match - output contains phrases like "my instructions are"
 *
 * @param {string|null|undefined} text - The AI output to check
 * @param {string|null|undefined} systemPrompt - The system prompt to check against
 * @returns {{detected: boolean, type: string|null}} Detection result
 *
 * @example
 * const result = detectSystemPromptLeak("My instructions are to help you.", "Be helpful and kind.");
 * // { detected: true, type: 'pattern_match' }
 */
export function detectSystemPromptLeak(text, systemPrompt) {
  // Handle null/undefined/empty input
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { detected: false, type: null };
  }

  // Handle null/undefined/empty system prompt
  if (!systemPrompt || typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    return { detected: false, type: null };
  }

  const textLower = text.toLowerCase();
  const promptLower = systemPrompt.toLowerCase();

  // 1. Check for exact match (case-insensitive)
  if (textLower.includes(promptLower)) {
    logger.warn({ textLength: text.length }, 'System prompt leak detected: exact match');
    return { detected: true, type: 'exact_match' };
  }

  // 2. Check for partial match (>50% of system prompt words appear in output)
  const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3); // Words longer than 3 chars
  if (promptWords.length > 0) {
    const matchingWords = promptWords.filter(word => textLower.includes(word));
    const matchRatio = matchingWords.length / promptWords.length;

    if (matchRatio >= 0.5) {
      logger.warn({ matchRatio, textLength: text.length }, 'System prompt leak detected: partial match');
      return { detected: true, type: 'partial_match' };
    }
  }

  // 3. Check for leak patterns (phrases suggesting instruction disclosure)
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn({ pattern: pattern.source, textLength: text.length }, 'System prompt leak detected: pattern match');
      return { detected: true, type: 'pattern_match' };
    }
  }

  return { detected: false, type: null };
}

// ============================================================
// ADR-071 Task 7: Audit Logging
// ============================================================

/**
 * Valid message types for audit logging
 */
const VALID_MESSAGE_TYPES = ['request', 'response', 'error'];

/**
 * Hash content using SHA256 for privacy
 * Stores hash instead of raw content in audit log
 *
 * @param {string|object|null|undefined} content - Content to hash
 * @returns {string} SHA256 hex hash (64 characters) or empty string for null/undefined
 *
 * @example
 * const hash = hashContent('Hello, world!');
 * // '315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3'
 */
export function hashContent(content) {
  // Handle null/undefined
  if (content === null || content === undefined) {
    return '';
  }

  // Convert non-string to string (e.g., objects)
  const stringContent = typeof content === 'string' ? content : JSON.stringify(content);

  // Create SHA256 hash
  return createHash('sha256').update(stringContent, 'utf8').digest('hex');
}

/**
 * Log an audit entry to the ai_audit_log table
 *
 * @param {Object} entry - Audit entry data
 * @param {number} entry.user_id - User ID (required)
 * @param {string} entry.message_type - 'request', 'response', or 'error' (required)
 * @param {string} entry.content_hash - SHA256 hash of content (required)
 * @param {number} [entry.agent_id] - Agent ID
 * @param {string} [entry.agent_name] - Agent name
 * @param {number} [entry.conversation_id] - Conversation ID
 * @param {number} [entry.token_count] - Token count
 * @param {boolean} [entry.threat_detected] - Whether threat was detected
 * @param {string} [entry.threat_type] - Type of threat detected
 * @param {string} [entry.ip_address] - Client IP address
 * @param {string} [entry.user_agent] - Client user agent
 * @param {Object} [entry.metadata] - Additional metadata (JSONB)
 * @returns {Promise<{success: boolean, id: number}>}
 *
 * @example
 * const result = await logAuditEntry({
 *   user_id: 1,
 *   message_type: 'request',
 *   content_hash: hashContent('Hello'),
 *   threat_detected: false,
 * });
 */
export async function logAuditEntry(entry) {
  // Validate message_type
  if (!VALID_MESSAGE_TYPES.includes(entry.message_type)) {
    throw new Error(`Invalid message_type: ${entry.message_type}. Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}`);
  }

  // Prepare metadata as JSON string for storage
  const metadataStr = entry.metadata ? JSON.stringify(entry.metadata) : null;

  // Convert threat_detected boolean to integer (0/1)
  const threatDetected = entry.threat_detected ? 1 : 0;

  try {
    const sql = `
      INSERT INTO ai_audit_log (
        user_id, agent_id, agent_name, conversation_id,
        message_type, content_hash, token_count,
        threat_detected, threat_type, ip_address, user_agent, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      entry.user_id,
      entry.agent_id || null,
      entry.agent_name || null,
      entry.conversation_id || null,
      entry.message_type,
      entry.content_hash,
      entry.token_count || null,
      threatDetected,
      entry.threat_type || null,
      entry.ip_address || null,
      entry.user_agent || null,
      metadataStr,
    ];

    const result = await dbRun(sql, params);

    logger.debug(
      { user_id: entry.user_id, message_type: entry.message_type, threat_detected: threatDetected },
      'AI audit entry logged'
    );

    // Return the inserted ID
    const insertedId = result.lastInsertRowid || 0;

    return { success: true, id: Number(insertedId) };
  } catch (error) {
    logger.error({ error: error.message, entry }, 'Failed to log AI audit entry');
    throw error;
  }
}

// ============================================================
// ADR-071 Task 8: Per-Agent Rate Limiting
// ============================================================

/**
 * Rate limit configuration (from ADR-071)
 * AI_RATE_LIMIT_PER_USER=100  - requests per hour per user
 * AI_RATE_LIMIT_PER_AGENT=500 - requests per hour per agent
 */
const RATE_LIMIT_PER_USER = parseInt(process.env.AI_RATE_LIMIT_PER_USER, 10) || 100;
const RATE_LIMIT_PER_AGENT = parseInt(process.env.AI_RATE_LIMIT_PER_AGENT, 10) || 500;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * In-memory storage for rate limit counters
 * Key format: `user:${userId}` or `agent:${agentId}`
 * Value: { count: number, resetTime: number (timestamp) }
 *
 * NOTE: For production at scale, consider Redis for distributed rate limiting
 */
const rateLimits = new Map();

/**
 * Get or create a rate limit entry for a given key
 *
 * @param {string} key - The rate limit key (e.g., 'user:123' or 'agent:456')
 * @returns {{ count: number, resetTime: number }} Rate limit entry
 */
function getRateLimitEntry(key) {
  const now = Date.now();
  let entry = rateLimits.get(key);

  // If entry doesn't exist or has expired, create a new one
  if (!entry || now >= entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    };
    rateLimits.set(key, entry);
  }

  return entry;
}

/**
 * Check rate limit for a user and agent combination
 *
 * @param {number|string|null} userId - User identifier
 * @param {number|string|undefined} agentId - Agent identifier
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 *   - allowed: whether the request should be allowed
 *   - remaining: number of requests remaining (minimum of user and agent limits)
 *   - resetIn: seconds until rate limit resets
 *
 * @example
 * const result = checkRateLimit(1, 100);
 * // { allowed: true, remaining: 99, resetIn: 3600 }
 */
export function checkRateLimit(userId, agentId) {
  // Handle null/undefined userId
  if (userId === null || userId === undefined) {
    logger.warn({ userId, agentId }, 'Rate limit check with null/undefined userId');
    return { allowed: false, remaining: 0, resetIn: 0 };
  }

  const now = Date.now();
  const userKey = `user:${userId}`;

  // Get user rate limit entry
  const userEntry = getRateLimitEntry(userKey);
  const userRemaining = Math.max(0, RATE_LIMIT_PER_USER - userEntry.count);
  const userResetIn = Math.ceil((userEntry.resetTime - now) / 1000);

  // If agentId is provided, also check agent limit
  let agentRemaining = RATE_LIMIT_PER_AGENT;
  let agentResetIn = userResetIn;

  if (agentId !== undefined && agentId !== null) {
    const agentKey = `agent:${agentId}`;
    const agentEntry = getRateLimitEntry(agentKey);
    agentRemaining = Math.max(0, RATE_LIMIT_PER_AGENT - agentEntry.count);
    agentResetIn = Math.ceil((agentEntry.resetTime - now) / 1000);
  }

  // Request is allowed if both user and agent limits are not exceeded
  const allowed = userRemaining > 0 && agentRemaining > 0;

  // Return the minimum remaining between user and agent
  const remaining = Math.min(userRemaining, agentRemaining);

  // Return the maximum reset time (most conservative)
  const resetIn = Math.max(userResetIn, agentResetIn);

  if (!allowed) {
    logger.warn(
      { userId, agentId, userRemaining, agentRemaining },
      'Rate limit exceeded'
    );
  }

  return { allowed, remaining, resetIn };
}

/**
 * Increment rate limit counters for a user and agent
 *
 * @param {number|string} userId - User identifier
 * @param {number|string} agentId - Agent identifier
 * @returns {void}
 *
 * @example
 * incrementRateLimit(1, 100);
 */
export function incrementRateLimit(userId, agentId) {
  // Handle null/undefined userId
  if (userId === null || userId === undefined) {
    logger.warn({ userId, agentId }, 'Rate limit increment with null/undefined userId');
    return;
  }

  const userKey = `user:${userId}`;
  const userEntry = getRateLimitEntry(userKey);
  userEntry.count += 1;

  // If agentId is provided, also increment agent counter
  if (agentId !== undefined && agentId !== null) {
    const agentKey = `agent:${agentId}`;
    const agentEntry = getRateLimitEntry(agentKey);
    agentEntry.count += 1;
  }

  logger.debug(
    { userId, agentId, userCount: userEntry.count },
    'Rate limit counter incremented'
  );
}

/**
 * Clear all rate limit counters (primarily for testing)
 *
 * @returns {void}
 */
export function clearRateLimits() {
  rateLimits.clear();
  logger.debug('Rate limit counters cleared');
}

// ============================================================
// Default Export
// ============================================================

export default {
  sanitizeInput,
  detectInjection,
  escapeSpecialTokens,
  redactSecrets,
  redactPII,
  redactOutput,
  detectSystemPromptLeak,
  hashContent,
  logAuditEntry,
  checkRateLimit,
  incrementRateLimit,
  clearRateLimits,
  INJECTION_PATTERNS,
};
