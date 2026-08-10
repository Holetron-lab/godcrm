/**
 * ADR-097: Chat partner selection handlers
 * Extracted from AIChatPanel.tsx (lines 2227-2427)
 *
 * Provides agent/user/group selection, vector search, favorites,
 * and conversation selection with bound-row restoration.
 */

import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent } from '../types';

export interface ChatPartner {
  type: 'agent' | 'user' | 'group';
  id: number;
  name: string;
  icon?: string;
  email?: string;
  avatarUrl?: string;
  participants?: Array<{ id: number; name: string; type?: string }>;
}

export interface ChatParticipant {
  id: number;
  name: string;
  type: string;
}

export interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

export interface UseChatPartnerSelectionParams {
  agents: AIAgent[];
  currentAgent: AIAgent | null;
  currentConversationId: number | null;
  userConversationId: number | null;
  chatPartner: ChatPartner | null;
  chatParticipants: ChatParticipant[];
  agentsSearch: string;
  currentSpaceId: number | null | undefined;
  /** Flat list of all tables for looking up table info */
  allTablesFlat: Array<{ id: number | string; name?: string; icon?: string | null }> | undefined;
  favorites: number[];
  selectAgent: (agent: AIAgent) => void;
  selectConversation: (id: number) => Promise<{
    bound_table_id?: number | null;
    bound_row_id?: number | null;
    title?: string | null;
    [key: string]: unknown;
  } | undefined>;
  setChatMode: (v: 'ai' | 'user') => void;
  setChatPartner: (v: ChatPartner | null) => void;
  setChatParticipants: (v: ChatParticipant[]) => void;
  setBoundRows: (v: BoundRow[]) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  setActivePanel: (v: string) => void;
  setVectorSearchResults: (v: number[] | null) => void;
  setIsVectorSearching: (v: boolean) => void;
  setUserConversationId: (v: number | null) => void;
  setFavorites: (fn: (prev: number[]) => number[]) => void;
}

export interface UseChatPartnerSelectionReturn {
  handleAgentSelect: (agent: AIAgent) => void;
  handleVectorSearch: () => Promise<void>;
  handleUserSelect: (user: {
    id: number;
    name: string;
    email?: string | null;
    avatar_url?: string | null;
    managed_by_agent_table_id?: number | null;
  }) => void;
  handleAddToGroup: (user: { id: number; name: string }) => void;
  toggleFavorite: (userId: number) => void;
  handleConversationSelect: (id: number) => Promise<void>;
}

export function useChatPartnerSelection({
  agents,
  currentAgent,
  currentConversationId,
  userConversationId,
  chatPartner,
  chatParticipants,
  agentsSearch,
  currentSpaceId,
  allTablesFlat,
  selectAgent,
  selectConversation,
  setChatMode,
  setChatPartner,
  setChatParticipants,
  setBoundRows,
  setShowBoundRowsBar,
  setActivePanel,
  setVectorSearchResults,
  setIsVectorSearching,
  setUserConversationId,
  setFavorites,
}: UseChatPartnerSelectionParams): UseChatPartnerSelectionReturn {

  const handleAgentSelect = (agent: AIAgent) => {
    selectAgent(agent);
    setChatMode('ai');
    setChatPartner({
      type: 'agent',
      id: agent.id,
      name: agent.name,
      icon: agent.icon
    });
    setChatParticipants([]);
    setBoundRows([]); // Ticket #42127: Clear bound rows when switching to agent
    setShowBoundRowsBar(false);
    setActivePanel('none');
    // Clear vector search results on select
    setVectorSearchResults(null);
  };

  // Vector search for agents
  const handleVectorSearch = async () => {
    if (!agentsSearch || !currentSpaceId) return;

    setIsVectorSearching(true);
    try {
      const response = await apiClient.post<{ success: boolean; agents?: Array<{ id: number }> }>('/ai/agents/search', {
        query: agentsSearch,
        spaceId: currentSpaceId,
        limit: 10
      });

      if (response.success && response.agents) {
        setVectorSearchResults(response.agents.map(a => a.id));
      }
    } catch (error) {
      logger.error('Vector search failed:', error);
      // Fallback to text search
    } finally {
      setIsVectorSearching(false);
    }
  };

  const handleUserSelect = (user: { id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null }) => {
    const isAgent = user.managed_by_agent_table_id != null;
    if (isAgent) {
      // If clicking on AI agent user, find corresponding agent and select it
      const agent = agents.find(a => a.name === user.name);
      if (agent) {
        handleAgentSelect(agent);
        return;
      }
    }
    // Reset conversation ID so auto-load effect fetches the correct conversation for this user
    setUserConversationId(null);
    // Open chat with this user
    setChatPartner({
      type: 'user',
      id: user.id,
      name: user.name,
      email: user.email ?? undefined,
      avatarUrl: user.avatar_url ?? undefined
    });
    setChatParticipants([{ id: user.id, name: user.name, type: 'user' }]);
    setBoundRows([]); // Ticket #42127: Clear bound rows when selecting a contact
    setShowBoundRowsBar(false);
    setActivePanel('none');
  };

  const handleAddToGroup = (user: { id: number; name: string }) => {
    const isInChat = chatParticipants.some(p => p.id === user.id);
    // Determine the active conversation ID for API persistence
    const activeConvId = userConversationId || currentConversationId;
    if (isInChat) {
      const newParticipants = chatParticipants.filter(p => p.id !== user.id);
      setChatParticipants(newParticipants);
      // Persist removal to backend so it survives page reload
      if (activeConvId) {
        apiClient.delete(`/chat/conversations/${activeConvId}/participants/${user.id}`).catch((err) => {
          logger.warn('[Chat] Failed to remove participant from backend:', err);
        });
      }
      // Update chatPartner for group
      if (newParticipants.length === 0) {
        // No participants, switch back to agent if available
        if (currentAgent) {
          setChatPartner({
            type: 'agent',
            id: currentAgent.id,
            name: currentAgent.name,
            icon: currentAgent.icon
          });
        }
      } else if (newParticipants.length === 1) {
        setChatPartner({
          type: 'user',
          id: newParticipants[0].id,
          name: newParticipants[0].name
        });
      } else {
        setChatPartner({
          type: 'group',
          id: 0,
          name: `Группа (${newParticipants.length})`,
          participants: newParticipants
        });
      }
    } else {
      const newParticipants = [...chatParticipants, { id: user.id, name: user.name, type: 'user' as const }];
      setChatParticipants(newParticipants);
      // Persist addition to backend so it survives page reload
      if (activeConvId) {
        apiClient.post(`/chat/conversations/${activeConvId}/participants`, {
          user_id: user.id,
          role: 'member'
        }).catch((err) => {
          // 409 = already exists, that's fine
          if ((err as { status?: number })?.status !== 409) {
            logger.warn('[Chat] Failed to add participant to backend:', err);
          }
        });
      }
      if (newParticipants.length === 1) {
        setChatPartner({
          type: 'user',
          id: user.id,
          name: user.name
        });
      } else {
        setChatPartner({
          type: 'group',
          id: 0,
          name: `Группа (${newParticipants.length})`,
          participants: newParticipants
        });
      }
    }
  };

  const handleConversationSelect = async (id: number) => {
    const result = await selectConversation(id);
    // Ticket #77792: Restore bound rows from backend instead of blindly clearing
    if (result?.bound_table_id && result?.bound_row_id) {
      const tableInfo = allTablesFlat?.find(
        t => String(t.id) === String(result.bound_table_id)
      );
      // Bug fix: fetch row_title from the table so bound row shows name instead of just ID
      let rowTitle: string | undefined;
      try {
        const rowResp = await apiClient.get<{ success: boolean; data: { row: Record<string, unknown> } }>(
          `/tables/${result.bound_table_id}/rows/${result.bound_row_id}`
        );
        if (rowResp.success && rowResp.data?.row) {
          // API returns row data nested under data.row.data (not data.row directly)
          const rowData = (rowResp.data.row as { data?: Record<string, unknown> }).data || rowResp.data.row;
          // Try common name column keys (case-insensitive)
          const nameKeys = ['name', 'title', 'what', 'subject', 'label', 'Name', 'Title', 'What', 'Subject', 'Label'];
          for (const key of nameKeys) {
            if (rowData[key] && typeof rowData[key] === 'string') {
              rowTitle = rowData[key] as string;
              break;
            }
          }
          // Fallback: use the first non-id, non-metadata string value from the row
          if (!rowTitle) {
            const skipKeys = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'sort_order', 'row_id']);
            for (const [key, val] of Object.entries(rowData)) {
              if (!skipKeys.has(key) && typeof val === 'string' && val.trim().length > 0 && val.length < 200) {
                rowTitle = val;
                break;
              }
            }
          }
        }
      } catch (err) {
        logger.warn('[AIChatPanel] Failed to fetch bound row title:', err);
      }
      setBoundRows([{
        table_id: result.bound_table_id,
        row_id: result.bound_row_id,
        table_name: tableInfo?.name || undefined,
        table_icon: (tableInfo?.icon as string) || undefined,
        row_title: rowTitle || undefined,
      }]);
      setShowBoundRowsBar(true);
    } else {
      setBoundRows([]); // Ticket #42127: Clear bound rows when switching conversations
      setShowBoundRowsBar(false);
    }
    // Bug fix: update chatPartner name with conversation title (prevents agent sync useEffect from overwriting)
    if (result?.title && chatPartner) {
      setChatPartner({ ...chatPartner, name: result.title as string });
    }
    setActivePanel('none');
  };

  const toggleFavorite = (userId: number) => {
    setFavorites((prev: number[]) =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  return {
    handleAgentSelect,
    handleVectorSearch,
    handleUserSelect,
    handleAddToGroup,
    toggleFavorite,
    handleConversationSelect,
  };
}
