/**
 * CommandClassifier - ADR-076: Terminal Command Risk Classification
 *
 * Classifies shell commands into risk levels:
 * - safe: read-only commands (ls, cat, grep, git status)
 * - medium: write commands that are reversible (git commit, npm install, mkdir)
 * - dangerous: destructive/irreversible commands (rm -rf, sudo, git push --force)
 */

import { logger } from '../utils/logger.js';

/** @typedef {'safe' | 'medium' | 'dangerous'} RiskLevel */

/**
 * Patterns for dangerous commands
 * These require explicit approval before execution
 */
const DANGEROUS_PATTERNS = [
  // Destructive file operations
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive|--force)/,
  /\brm\s+-rf\b/,
  // Elevated privileges
  /\bsudo\b/,
  /\bsu\s+-?\s*$/,
  /\bsu\s+\w/,
  // Git destructive
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  // Database destructive
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*;?\s*$/i,
  // System control
  /\bsystemctl\s+(restart|stop|disable)\b/,
  /\bservice\s+\w+\s+(restart|stop)\b/,
  /\bkill\s+(-9|-KILL)\b/,
  /\bkillall\b/,
  /\bpkill\b/,
  // Publishing/deploying
  /\bnpm\s+publish\b/,
  /\bdeploy\b/,
  // Permissions
  /\bchmod\s+777\b/,
  /\bchown\s+-R\b/,
  // Shell bombs and pipes to shell
  /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  /\bcurl\b.*\|\s*(bash|sh|zsh)\b/,
  /\bwget\b.*\|\s*(bash|sh|zsh)\b/,
  // Format/wipe
  /\bmkfs\b/,
  /\bdd\s+if=/,
].filter(Boolean);

/**
 * Patterns for medium-risk commands
 * These execute immediately but are logged
 */
const MEDIUM_PATTERNS = [
  // Git write operations
  /\bgit\s+(commit|push|merge|rebase|checkout|branch\s+-[dD])\b/,
  /\bgit\s+stash\s+(drop|clear)\b/,
  // Package management
  /\bnpm\s+(install|update|uninstall|ci)\b/,
  /\byarn\s+(add|remove|upgrade)\b/,
  /\bpnpm\s+(install|add|remove|update)\b/,
  // File write operations
  /\bmv\b/,
  /\bcp\s+-r\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  // Text processing that modifies files
  /\bsed\s+-i\b/,
  /\bawk\b.*>>/,
  // File write redirects
  />\s*[^>]/,
  />>/,
  // Build operations
  /\bnpm\s+run\s+build\b/,
  /\bnpx\b/,
];

/**
 * Classify a shell command by risk level
 * @param {string} command - The command to classify
 * @returns {{ riskLevel: RiskLevel, matchedPattern: string | null }}
 */
export function classifyCommand(command) {
  if (!command || typeof command !== 'string') {
    return { riskLevel: 'safe', matchedPattern: null };
  }

  const trimmed = command.trim();

  // Check dangerous first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern && pattern.test(trimmed)) {
      logger.debug({ command: trimmed, pattern: pattern.toString() }, 'Command classified as dangerous');
      return { riskLevel: 'dangerous', matchedPattern: pattern.toString() };
    }
  }

  // Check medium
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(trimmed)) {
      logger.debug({ command: trimmed, pattern: pattern.toString() }, 'Command classified as medium');
      return { riskLevel: 'medium', matchedPattern: pattern.toString() };
    }
  }

  // Default: safe
  return { riskLevel: 'safe', matchedPattern: null };
}

/**
 * Check if a command needs approval
 * @param {string} command
 * @returns {boolean}
 */
export function needsApproval(command) {
  const { riskLevel } = classifyCommand(command);
  return riskLevel === 'dangerous';
}
