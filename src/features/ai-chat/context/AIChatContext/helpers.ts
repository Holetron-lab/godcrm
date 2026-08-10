import { logger } from '@/shared/utils/logger';

/**
 * Retry wrapper for API calls that fail with rate limit (429) or gateway errors (502/503).
 * Automatically retries with increasing delays.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: number[] = [3000, 8000, 20000]
): Promise<T> {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = /429|502|503|rate.?limit/i.test(msg);

      if (!isRetryable || attempt >= delays.length) {
        throw err;
      }

      const delay = delays[attempt];
      logger.warn(`[AI Chat] Retryable error, retry ${attempt + 1}/${delays.length} in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Generate a smart conversation title from the first user message.
 * - Strips markdown formatting, code blocks, URLs
 * - Truncates at word boundary (max 60 chars)
 * - Falls back to "New chat" if content is empty
 */
export function generateConversationTitle(content: string): string {
  if (!content || !content.trim()) return 'New chat';

  let title = content
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]+`/g, '')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '')
    // Remove markdown formatting (bold, italic, headers)
    .replace(/[#*_~>]+/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) return 'New chat';

  // Truncate at word boundary, max 60 chars
  if (title.length > 60) {
    title = title.substring(0, 60);
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 30) {
      title = title.substring(0, lastSpace);
    }
    title += '...';
  }

  return title;
}
