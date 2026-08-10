/**
 * HighlightedText Component
 * ADR-116: Structured Invocation Tokens
 *
 * Renders text with 4 token formats:
 *   <<@slug>>  -> MentionPill  (invocation — blue pill with user icon)
 *   @slug      -> MentionPill  (same card as <<@slug>>)
 *   <</slug>>  -> CommandPill  (invocation — purple pill with bot icon)
 *   /slug      -> subtle reference highlight (purple text)
 */

import React, { useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { MentionPill, CommandPill } from './InvocationPills';
import { MentionTooltip } from './MentionTooltip';
import { useValidSlugs } from '../context/ValidSlugsContext';

interface HighlightedTextProps {
  /** The raw text content to render */
  text: string;
  /** Callback when a @mention or /command is clicked — receives the full token (e.g. "@dev-user" or "/developer") */
  onMentionClick?: (token: string) => void;
  /** Additional class names for the wrapper */
  className?: string;
}

// Segment types for the parsed output
type Segment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string }            // clickable URL
  | { type: 'mention'; value: string }        // plain @slug — subtle highlight
  | { type: 'command'; value: string }         // plain /slug — subtle highlight
  | { type: 'mention-pill'; slug: string }     // <<@slug>> — invocation pill
  | { type: 'command-pill'; slug: string };    // <</slug>> — invocation pill

/**
 * Parses text and returns an array of segments covering all 4 token formats.
 *
 * Order matters: we match structured tokens (<<...>>) first so they are not
 * consumed by the plain @slug / /slug patterns.
 */
function parseSegments(text: string): Segment[] {
  // Combined regex that matches all four patterns in priority order:
  //   1. <<@slug>>   — structured mention invocation
  //   2. <</slug>>   — structured command invocation
  //   3. @slug       — plain mention reference (after whitespace or start)
  //   4. /slug       — plain command reference (after whitespace or start)
  const TOKEN_REGEX = /<<@([a-z0-9][a-z0-9_-]*)>>|<<\/([a-z0-9][a-z0-9_-]*)>>|(^|[\s\n])(@[a-z0-9][a-z0-9_-]*)|(^|[\s\n])(\/[a-z0-9][a-z0-9_-]*)/gim;

  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const matchStart = match.index;

    if (match[1] !== undefined) {
      // <<@slug>> — mention pill
      if (matchStart > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, matchStart) });
      }
      segments.push({ type: 'mention-pill', slug: match[1].toLowerCase() });
      lastIndex = matchStart + match[0].length;
    } else if (match[2] !== undefined) {
      // <</slug>> — command pill
      if (matchStart > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, matchStart) });
      }
      segments.push({ type: 'command-pill', slug: match[2].toLowerCase() });
      lastIndex = matchStart + match[0].length;
    } else if (match[4] !== undefined) {
      // plain @slug — subtle highlight
      const prefix = match[3]; // whitespace or empty
      const token = match[4];
      const beforeText = text.slice(lastIndex, matchStart) + prefix;
      if (beforeText) {
        segments.push({ type: 'text', value: beforeText });
      }
      segments.push({ type: 'mention', value: token });
      lastIndex = matchStart + match[0].length;
    } else if (match[6] !== undefined) {
      // plain /slug — subtle highlight
      const prefix = match[5]; // whitespace or empty
      const token = match[6];
      const beforeText = text.slice(lastIndex, matchStart) + prefix;
      if (beforeText) {
        segments.push({ type: 'text', value: beforeText });
      }
      segments.push({ type: 'command', value: token });
      lastIndex = matchStart + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  // If no matches at all, return the full text
  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  // Second pass: split text segments to extract URLs
  return splitTextSegmentsForUrls(segments);
}

/**
 * URL regex matching:
 *   - https://... or http://...
 *   - www. followed by domain (auto-prefixed with https:// for href)
 * Stops at whitespace, quotes, or common trailing punctuation not part of URLs.
 */
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/gi;

/**
 * Takes a segment array and splits any 'text' segments into 'text' and 'url'
 * segments wherever URLs are found.
 */
function splitTextSegmentsForUrls(segments: Segment[]): Segment[] {
  const result: Segment[] = [];

  for (const seg of segments) {
    if (seg.type !== 'text') {
      result.push(seg);
      continue;
    }

    const text = seg.value;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state for each segment
    URL_REGEX.lastIndex = 0;

    while ((match = URL_REGEX.exec(text)) !== null) {
      // Push text before the URL
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      result.push({ type: 'url', value: match[0] });
      lastIndex = match.index + match[0].length;
    }

    // Push remaining text after last URL (or entire text if no URLs found)
    if (lastIndex < text.length) {
      result.push({ type: 'text', value: text.slice(lastIndex) });
    }
  }

  return result;
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  onMentionClick,
  className,
}) => {
  const { mentionSlugs, commandSlugs } = useValidSlugs();

  const handleClick = useCallback(
    (token: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onMentionClick?.(token);
    },
    [onMentionClick]
  );

  if (!text) return null;

  const segments = parseSegments(text);

  // If there are no mentions or URLs, just render plain text (fast path)
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)} style={{ overflowWrap: 'anywhere' }}>
      {segments.map((seg, idx) => {
        switch (seg.type) {
          case 'text':
            return <React.Fragment key={idx}>{seg.value}</React.Fragment>;

          case 'url':
            return (
              <a
                key={idx}
                href={seg.value.startsWith('http') ? seg.value : `https://${seg.value}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline break-all text-[var(--color-primary-400)] hover:text-[var(--color-primary-300)] transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {seg.value}
              </a>
            );

          case 'mention-pill':
            // ADR-116: <<@slug>> — invocation pill
            return (
              <MentionPill
                key={idx}
                slug={seg.slug}
                onClick={onMentionClick}
              />
            );

          case 'command-pill':
            // ADR-116: <</slug>> — invocation pill
            return (
              <CommandPill
                key={idx}
                slug={seg.slug}
                onClick={onMentionClick}
              />
            );

          case 'mention': {
            // Plain @slug — validate against known slugs
            const mentionSlug = seg.value.replace(/^@/, '').toLowerCase();
            if (mentionSlugs.size > 0 && !mentionSlugs.has(mentionSlug)) {
              // Not a valid user/agent — render as plain text
              return <React.Fragment key={idx}>{seg.value}</React.Fragment>;
            }
            return (
              <MentionPill
                key={idx}
                slug={mentionSlug}
                onClick={onMentionClick}
              />
            );
          }

          case 'command': {
            // Plain /slug — validate against known agents
            const cmdSlug = seg.value.replace(/^\//, '').toLowerCase();
            if (commandSlugs.size > 0 && !commandSlugs.has(cmdSlug)) {
              // Not a valid command — render as plain text
              return <React.Fragment key={idx}>{seg.value}</React.Fragment>;
            }
            return (
              <MentionTooltip key={idx} slug={cmdSlug}>
                <span
                  onClick={(e) => handleClick(seg.value, e)}
                  className={cn(
                    'cursor-pointer font-medium transition-colors',
                    'text-purple-400 hover:text-purple-300',
                    'hover:underline'
                  )}
                  title={`Command ${seg.value}`}
                  role="button"
                  tabIndex={0}
                >
                {seg.value}
              </span>
              </MentionTooltip>
            );
          }

          default:
            return null;
        }
      })}
    </span>
  );
};

export default HighlightedText;
