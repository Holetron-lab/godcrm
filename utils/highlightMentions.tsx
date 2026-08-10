/**
 * ADR-069: Highlight @mentions and /commands in message content
 * Extracted from AIChatPanel.tsx (lines 105-129)
 */

import React from 'react';
import { cn } from '@/shared/utils/cn';

/**
 * Highlight @mentions and /commands in message content
 * @param content - Message text
 * @returns React elements with highlighted mentions/commands
 */
export function highlightMentions(content: string): React.ReactNode {
  // Pattern for @mentions and /commands
  const pattern = /([@/][a-z0-9_-]+)/gi;
  const parts = content.split(pattern);

  return parts.map((part, index) => {
    if (part.startsWith('@') || part.startsWith('/')) {
      const isCommand = part.startsWith('/');
      return (
        <span
          key={index}
          className={cn(
            'font-medium rounded px-0.5',
            isCommand
              ? 'text-blue-400 bg-blue-500/20' // /command - blue
              : 'text-purple-400 bg-purple-500/20' // @mention - purple
          )}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}
