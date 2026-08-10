/**
 * Parse a forwarded message from the chat.
 *
 * Expected format:
 *   --- Переслано от <SenderName> (<timestamp>) ---
 *   <message content>
 *   --- конец пересланного сообщения ---
 *
 * The timestamp part (parenthesized) and the closing footer line are both optional.
 */

export interface ForwardedMessage {
  senderName: string;
  timestamp: string | null;
  content: string;
}

const HEADER_REGEX = /^--- Переслано от (.+?)(?:\s*\(([^)]+)\))?\s*---$/;
const FOOTER = '--- конец пересланного сообщения ---';

export function parseForwardedMessage(text: string): ForwardedMessage | null {
  if (!text) return null;

  const lines = text.split('\n');
  const headerMatch = lines[0].match(HEADER_REGEX);

  if (!headerMatch) return null;

  const senderName = headerMatch[1].trim();
  const timestamp = headerMatch[2]?.trim() ?? null;

  // Extract content between header and optional footer
  const contentLines = lines.slice(1);

  // Remove trailing footer line if present
  const lastIdx = contentLines.length - 1;
  if (lastIdx >= 0 && contentLines[lastIdx].trim() === FOOTER) {
    contentLines.pop();
  }

  const content = contentLines.join('\n').trim();

  return { senderName, timestamp, content };
}
