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
