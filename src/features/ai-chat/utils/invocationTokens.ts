/**
 * ADR-116: Structured Invocation Token Utilities
 *
 * validateAndWrapMentions  — wraps bare @slug in <<@slug>> if slug is a known user
 * validateAndWrapCommands  — wraps bare /slug in <</slug>> if slug is a known agent
 *
 * Both functions are called on submit, just before sending the message content
 * to the backend, so that the backend always receives structured tokens.
 */

import type { MentionUser } from '../components/MentionInput';

/**
 * Task 11: Wrap bare @mentions with structured invocation tokens.
 *
 * Converts `@slug` to `<<@slug>>` when the slug matches a known user,
 * but only if the mention is not already wrapped (negative lookbehind for `<<`).
 */
export function validateAndWrapMentions(
  content: string,
  availableUsers: MentionUser[]
): string {
  const slugSet = new Set(
    availableUsers.map((u) =>
      u.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    )
  );

  return content.replace(
    /(?<!<<)@([a-z0-9_-]+)/gi,
    (match, slug) => {
      return slugSet.has(slug.toLowerCase())
        ? `<<@${slug.toLowerCase()}>>`
        : match;
    }
  );
}

/**
 * Task 12: Wrap bare /commands with structured invocation tokens.
 *
 * Converts `/slug` to `<</slug>>` when the slug matches a known agent,
 * but only if the command is not already wrapped (negative lookbehind for `<<`).
 * Only agents (user_type === 'agent') are considered valid command targets.
 */
export function validateAndWrapCommands(
  content: string,
  availableAgents: MentionUser[]
): string {
  const slugSet = new Set(
    availableAgents
      .filter((u) => u.type === 'agent')
      .map((u) =>
        u.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      )
  );

  return content.replace(
    /(?<!<<)(?:^|\s)\/(([a-z][a-z0-9_-]*))(?=\s|$)/gim,
    (match, slug) => {
      return slugSet.has(slug.toLowerCase())
        ? match.replace(`/${slug}`, `<</${slug.toLowerCase()}>>`)
        : match;
    }
  );
}

/**
 * Strip invocation tokens from content — converts <<@slug>> to @slug and <</slug>> to /slug.
 * Used when forwarding messages to prevent re-triggering agent invocations.
 */
export function stripInvocationTokens(content: string): string {
  return content
    .replace(/<<@([a-z0-9_-]+)>>/gi, '@$1')
    .replace(/<<\/([a-z0-9_-]+)>>/gi, '/$1');
}

// ---------------------------------------------------------------------------
// Agent invocation detection in thinking blocks
// ---------------------------------------------------------------------------
const INVOCATION_PATTERN = /<<@([a-z0-9_-]+)>>/gi;

/** Check if a thinking message contains agent invocation tokens.
 *  Ignores matches inside backtick-delimited code spans/blocks to avoid
 *  false positives when reasoning merely discusses the <<@slug>> syntax.
 */
export function detectInvocations(content: string | undefined | null): string[] {
  if (!content) return [];
  // Strip inline code (`...`) and fenced code blocks (```...```) before matching
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`]+`/g, '');          // inline code spans
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  INVOCATION_PATTERN.lastIndex = 0;
  while ((m = INVOCATION_PATTERN.exec(stripped)) !== null) {
    matches.push(m[1].toLowerCase());
  }
  return matches;
}
