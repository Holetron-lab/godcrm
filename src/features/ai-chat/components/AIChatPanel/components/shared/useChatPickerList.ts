/**
 * useChatPickerList — shared chat-picker list logic for ForwardMessageModal
 * and MoveMessageModal (ADR-0031 WP-24 FE).
 *
 * Wraps `useConversations` + a search input into a single hook so both modals
 * render the identical chat list without duplicated filter code.
 */
import { useMemo, useState } from 'react';
import { useConversations } from '../../../../hooks/useConversationMessages';

export interface ChatPickerListOptions {
  /** Conversation to exclude from the picker (usually the current one) */
  excludeConversationId?: number;
  /** Optional space scope */
  spaceId?: number;
  /** Max conversations to fetch */
  limit?: number;
}

export interface ChatPickerListResult {
  search: string;
  setSearch: (value: string) => void;
  filtered: any[];
  isLoading: boolean;
}

export function useChatPickerList(options: ChatPickerListOptions = {}): ChatPickerListResult {
  const { excludeConversationId, spaceId, limit = 100 } = options;
  const [search, setSearch] = useState('');

  const { data: conversations = [], isLoading } = useConversations({
    spaceId,
    limit,
  });

  const filtered = useMemo(() => {
    const list = (conversations as any[]).filter(
      (c) => c.id !== excludeConversationId
    );
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) =>
      ((c.title || '') as string).toLowerCase().includes(q) ||
      ((c.agent_name || '') as string).toLowerCase().includes(q)
    );
  }, [conversations, excludeConversationId, search]);

  return { search, setSearch, filtered, isLoading };
}
