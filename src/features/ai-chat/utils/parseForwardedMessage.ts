/**
 * Parse forwarded messages from chat content.
 *
 * Current blockquote format (from useEventHandlers.ts):
 *   > **SenderName** (timestamp)
 *   > message content line 1
 *   > message content line 2
 *   > _чат #convId, сообщение #msgId_
 *
 * Legacy format (preserved for backwards compat):
 *   --- Переслано от <SenderName> (<timestamp>) ---
 *   <message content>
 *   --- конец пересланного сообщения ---
 */

export interface ForwardedMessage {
  senderName: string;
  timestamp: string | null;
  content: string;
  conversationId: string | null;
  messageId: string | null;
  agentColor: string | null;
}

// Blockquote format: > **Sender** (timestamp)
const BQ_HEADER_REGEX = /^\*\*(.+?)\*\*\s*(?:\(([^)]+)\))?/;
// Footer: _чат #123, сообщение #456_ or _чат #123, сообщение #456, цвет #abc123_
const BQ_FOOTER_REGEX = /^_чат #(\d+),\s*сообщение #(\d+)(?:,\s*цвет (#[0-9a-fA-F]{3,8}))?_$/;

// Legacy format
const LEGACY_HEADER_REGEX = /^--- Переслано от (.+?)(?:\s*\(([^)]+)\))?\s*---$/;
const LEGACY_FOOTER = '--- конец пересланного сообщения ---';

/**
 * Parse multiple forwarded messages from blockquote content.
 * Returns array of parsed forwarded messages, or empty array if none found.
 */
export function parseForwardedMessages(text: string): ForwardedMessage[] {
  if (!text) return [];

  const results: ForwardedMessage[] = [];

  // Try blockquote format: split on double-newline between blockquotes
  const blockquoteBlocks = text.split(/\n\n(?=>|\*\*)/);

  for (const block of blockquoteBlocks) {
    const parsed = parseBlockquoteForward(block);
    if (parsed) results.push(parsed);
  }

  if (results.length > 0) return results;

  // Fallback: legacy format
  const legacy = parseLegacyForward(text);
  if (legacy) return [legacy];

  return [];
}

/** Parse a single blockquote-format forwarded message */
function parseBlockquoteForward(block: string): ForwardedMessage | null {
  const rawLines = block.split('\n');

  // Only collect lines that start with '>' (blockquote lines)
  // Stop at first non-quoted, non-empty line to avoid including user text
  const quotedLines: string[] = [];
  for (const line of rawLines) {
    if (line.startsWith('>')) {
      quotedLines.push(line.replace(/^>\s?/, ''));
    } else if (line.trim() === '' && quotedLines.length > 0) {
      // Skip empty lines between quoted blocks
      continue;
    } else if (quotedLines.length > 0) {
      break; // Non-quoted content = end of forward block
    }
  }

  if (quotedLines.length < 1) return null;

  const headerMatch = quotedLines[0].match(BQ_HEADER_REGEX);
  if (!headerMatch) return null;

  const senderName = headerMatch[1].trim();
  const timestamp = headerMatch[2]?.trim() ?? null;

  // Check last line for footer (chat/message reference + optional color)
  let conversationId: string | null = null;
  let messageId: string | null = null;
  let agentColor: string | null = null;
  let contentLines = quotedLines.slice(1);

  if (contentLines.length > 0) {
    const lastLine = contentLines[contentLines.length - 1].trim();
    const footerMatch = lastLine.match(BQ_FOOTER_REGEX);
    if (footerMatch) {
      conversationId = footerMatch[1];
      messageId = footerMatch[2];
      agentColor = footerMatch[3] || null;
      contentLines = contentLines.slice(0, -1);
    }
  }

  const content = contentLines.join('\n').trim();

  return { senderName, timestamp, content, conversationId, messageId, agentColor };
}

/** Parse legacy format forwarded message */
function parseLegacyForward(text: string): ForwardedMessage | null {
  const lines = text.split('\n');
  const headerMatch = lines[0].match(LEGACY_HEADER_REGEX);
  if (!headerMatch) return null;

  const senderName = headerMatch[1].trim();
  const timestamp = headerMatch[2]?.trim() ?? null;
  const contentLines = lines.slice(1);
  const lastIdx = contentLines.length - 1;
  if (lastIdx >= 0 && contentLines[lastIdx].trim() === LEGACY_FOOTER) {
    contentLines.pop();
  }

  return {
    senderName,
    timestamp,
    content: contentLines.join('\n').trim(),
    conversationId: null,
    messageId: null,
    agentColor: null,
  };
}

/** Single-message parser (backwards compat) */
export function parseForwardedMessage(text: string): ForwardedMessage | null {
  const results = parseForwardedMessages(text);
  return results[0] ?? null;
}
