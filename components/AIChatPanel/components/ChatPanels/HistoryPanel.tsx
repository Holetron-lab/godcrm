/**
 * @deprecated Ticket #81442: HistoryPanel is deprecated and no longer rendered.
 * All chat history is now shown in InboxPanel with unified filters (Ticket #81444).
 * Kept for reference only — will be removed in a future cleanup.
 *
 * HistoryPanel Component
 * Extracted from AIChatPanel.tsx - lines 1722-1808
 */

import { X, Search, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { SortDropdown, SortOption } from '../../../../components/SortDropdown';
import { AccordionChatItem } from '../../../../components/AccordionChatItem';
import { PanelTab } from '../../types';

interface Conversation {
  id: number;
  title: string;
  updatedAt: string;
  agentIcon?: string;
  agentName?: string;
  messagesCount?: number;
  participants?: unknown[];
  spaceName?: string;
  boundRowLabel?: string;
}

interface HistoryPanelProps {
  historySearch: string;
  setHistorySearch: (search: string) => void;
  sortOption: SortOption;
  setSortOption: (option: SortOption) => void;
  setActivePanel: (panel: PanelTab) => void;
  conversations: Conversation[];
  isLoadingConversations: boolean;
  currentConversationId: number | null;
  onConversationSelect: (conversation: Conversation) => void;
  onDeleteConversation: (conversationId: number) => void;
}

export function HistoryPanel({
  historySearch,
  setHistorySearch,
  sortOption,
  setSortOption,
  setActivePanel,
  conversations,
  isLoadingConversations,
  currentConversationId,
  onConversationSelect,
  onDeleteConversation
}: HistoryPanelProps) {
  // Filter conversations based on search
  const filteredConversations = conversations.filter(conv => {
    if (!historySearch) return true;
    const searchLower = historySearch.toLowerCase();
    return (conv.title?.toLowerCase().includes(searchLower)) ||
           (conv.agentName?.toLowerCase().includes(searchLower));
  });

  // Sort conversations based on sortOption
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    switch (sortOption) {
      case 'alphabet':
        return (a.title || '').localeCompare(b.title || '');
      case 'participants':
        const aCount = (a as any).participants?.length || 0;
        const bCount = (b as any).participants?.length || 0;
        return bCount - aCount;
      case 'space':
        const aSpace = (a as any).spaceName || '';
        const bSpace = (b as any).spaceName || '';
        return aSpace.localeCompare(bSpace);
      case 'date':
      default:
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    }
  });

  const handleConversationSelect = (convId: number) => {
    const conv = conversations.find(c => c.id === convId);
    if (conv) {
      onConversationSelect(conv);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with sort dropdown and close button */}
      <div className="p-2 border-b border-[var(--border-secondary)] flex items-center justify-between">
        <SortDropdown 
          value={sortOption} 
          onChange={setSortOption}
          options={['date', 'alphabet', 'space']}
        />
        <button
          onClick={() => setActivePanel('none')}
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Search */}
      <div className="px-2 py-1.5 border-b border-[var(--border-secondary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="Поиск в истории..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
          />
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingConversations ? (
          <div className="flex items-center justify-center py-8" role="status">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : sortedConversations.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            {historySearch ? 'Не найдено' : 'Нет истории чатов'}
          </div>
        ) : (
          sortedConversations.map(conv => (
            <AccordionChatItem
              key={conv.id}
              conversation={{
                id: conv.id,
                title: conv.title,
                type: 'chat',
                agentIcon: conv.agentIcon,
                agentName: conv.agentName,
                messagesCount: conv.messagesCount ?? 0,
                updatedAt: conv.updatedAt,
                participants: (conv as unknown as { participants?: Array<{ user_id: number; name: string }> }).participants,
                spaceName: (conv as unknown as { spaceName?: string }).spaceName,
                boundRowLabel: conv.boundRowLabel,
              }}
              isActive={currentConversationId === conv.id}
              onSelect={handleConversationSelect}
              onDelete={onDeleteConversation}
            />
          ))
        )}
      </div>
    </div>
  );
}