/**
 * ADR-0057 WP-B — Auth-error matcher for Claude CLI output.
 *
 * Claude Code CLI surfaces Anthropic API 401s (OAuth-token rotation race during
 * parallel CLI processes) as plain assistant text. Before WP-B those strings
 * were persisted via saveStepMessage as content_type='text' and rendered like
 * the agent's actual response. See conversation 3178 msg #558510 incident.
 *
 * This module exposes a single matcher used by agent-job/create.js to detect
 * the auth-error final response and route it to an agent_status row instead.
 */

const AUTH_ERROR_PATTERNS = [
  /^Failed to authenticate\. API Error: 401\b/i,
  /^Invalid authentication credentials(?:[.:][^\r\n]*)?$/i,
  /^authentication_error(?::[^\r\n]*)?$/i,
  /^invalid_api_key(?::[^\r\n]*)?$/i,
  /^OAuth token expired(?:[.:][^\r\n]*)?$/i,
];

export function isAuthError(text) {
  if (typeof text !== 'string' || !text) return false;
  // Match the CLI error envelope, not error names quoted in an agent's diagnosis.
  const content = text.trim().replace(/^API Error: 401\s+/i, '');
  if (AUTH_ERROR_PATTERNS.some((re) => re.test(content))) return true;
  try {
    const payload = JSON.parse(content);
    return payload?.type === 'error' &&
      ['authentication_error', 'invalid_api_key'].includes(payload.error?.type);
  } catch {
    return false;
  }
}

/**
 * ADR-0057 WP-B (step-level extension): decide whether a streamed assistant
 * content block should be suppressed from chat because it's a leaked CLI
 * auth-error blob.
 *
 * The original WP-B only guarded the *final* result content. But the Claude CLI
 * also surfaces 401s mid-run as a `thinking` or `text` block during OAuth-token
 * rotation (see conv 3454 msgs 678432/678434, conv 2068 680051/680053). Those
 * leak into chat as raw "Invalid authentication credentials" bubbles AND count
 * as step output — which suppresses the empty-result safety net, so the turn
 * ends with no final text and only a Continue button.
 */
export function isAuthErrorBlock(block) {
  if (!block || typeof block !== 'object') return false;
  const text =
    block.type === 'thinking' ? block.thinking :
    block.type === 'text' ? block.text :
    null;
  return isAuthError(text);
}

/** Pull the Anthropic request_id out of the error blob, if present. */
export function extractRequestId(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/request_id["':\s]+(req_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
