/**
 * ADR-0057-A WP-A — parse `<<@slug>>` / `<</slug>>` invocations out of a message.
 *
 * Returns deduplicated slugs in order of first appearance. Used at send time to
 * create one optimistic `agent-pending-${slug}-${ts}` placeholder per invoked
 * agent (instead of a single placeholder that silently drops every slug past
 * the first).
 *
 * Code spans (` ... ` and ``` ... ```) are stripped before matching so prose
 * about the `<<@slug>>` syntax does not produce false positives — same rule
 * the renderer applies in `groupMessagesIntoTurns#detectInvocations`.
 */

export interface InvokedAgent {
  /** Lowercase slug as it appeared in the token. */
  slug: string;
  /** `<<@slug>>` (mention) vs `<</slug>>` (command). Used only for diagnostics today. */
  kind: 'mention' | 'command';
}

const MENTION_PATTERN = /<<@([a-z0-9_-]+)>>/gi;
const COMMAND_PATTERN = /<<\/([a-z0-9_-]+)(?:\/\d+)?>>/gi;

function stripCode(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');
}

export function parseInvocations(content: string | null | undefined): InvokedAgent[] {
  if (!content) return [];
  const stripped = stripCode(content);
  const seen = new Set<string>();
  const out: InvokedAgent[] = [];

  MENTION_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_PATTERN.exec(stripped)) !== null) {
    const slug = m[1].toLowerCase();
    if (!seen.has(slug)) { seen.add(slug); out.push({ slug, kind: 'mention' }); }
  }

  COMMAND_PATTERN.lastIndex = 0;
  while ((m = COMMAND_PATTERN.exec(stripped)) !== null) {
    const slug = m[1].toLowerCase();
    if (!seen.has(slug)) { seen.add(slug); out.push({ slug, kind: 'command' }); }
  }

  return out;
}

/** Slugify an agent's display name the same way invocation tokens are formed
 *  (`'Developer Ralph'` → `'developer-ralph'`). Used to match polled status rows
 *  against per-agent optimistic placeholders. */
export function slugifyAgentName(name: string | null | undefined): string | null {
  if (!name) return null;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}
