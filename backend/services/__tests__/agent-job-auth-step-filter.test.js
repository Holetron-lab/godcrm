/**
 * ADR-0057 WP-B (step-level extension) — auth-error blocks in streamed steps.
 *
 * Bug (reported conv 3455, GERATRON 2026-07-06): the Claude CLI surfaces
 * Anthropic 401s ("Failed to authenticate. API Error: 401 Invalid
 * authentication credentials") mid-run as a `thinking`/`text` block during
 * OAuth-token rotation. The original WP-B only guarded the *final* result, so
 * these leaked into chat as raw auth-error bubbles ("два 401 в фоновых шагах")
 * and — worse — counted as step output, suppressing the empty-result safety
 * net so the turn ended with no final text and only a Continue button.
 *
 * isAuthErrorBlock() is the gate onEvent uses to skip those blocks. These are
 * the exact production blobs captured from the incident (conv 3454 msgs
 * 678432/678434, conv 2068 680051/680053).
 */
import { describe, it, expect } from 'vitest';
import { isAuthErrorBlock } from '../agent-job/auth-error.js';

// Real captured blob (truncated as stored: content_type='thinking', 73 chars).
const CLI_401_BLOB = 'Failed to authenticate. API Error: 401 Invalid authentication credentials';

describe('isAuthErrorBlock — step-level 401 suppression', () => {
  it('suppresses a thinking block carrying the CLI 401 blob', () => {
    expect(isAuthErrorBlock({ type: 'thinking', thinking: CLI_401_BLOB })).toBe(true);
  });

  it('suppresses a text block carrying the CLI 401 blob', () => {
    expect(isAuthErrorBlock({ type: 'text', text: CLI_401_BLOB })).toBe(true);
  });

  it('matches the other known auth-error phrasings on either block kind', () => {
    expect(isAuthErrorBlock({ type: 'thinking', thinking: 'authentication_error: OAuth token expired' })).toBe(true);
    expect(isAuthErrorBlock({ type: 'text', text: 'invalid_api_key' })).toBe(true);
  });

  it('does NOT suppress genuine reasoning/answer text', () => {
    expect(isAuthErrorBlock({ type: 'thinking', thinking: 'Проверяю миграцию 077 — name-set == marker-set.' })).toBe(false);
    expect(isAuthErrorBlock({ type: 'text', text: 'Готово, Phase 3a зелёная.' })).toBe(false);
  });

  it('never suppresses non-text blocks (tool_use / tool_result carry no free text)', () => {
    expect(isAuthErrorBlock({ type: 'tool_use', name: 'Bash', input: {} })).toBe(false);
    expect(isAuthErrorBlock({ type: 'tool_result', content: CLI_401_BLOB })).toBe(false);
  });

  it('is null/shape-safe', () => {
    expect(isAuthErrorBlock(null)).toBe(false);
    expect(isAuthErrorBlock(undefined)).toBe(false);
    expect(isAuthErrorBlock('a string')).toBe(false);
    expect(isAuthErrorBlock({ type: 'thinking' })).toBe(false); // no .thinking
  });
});
