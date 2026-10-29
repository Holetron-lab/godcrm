/**
 * MentionUsersContext — provides slug→agent/user lookup for MentionTooltip
 */

import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { fetchAllAgents } from '../api/fetchAllAgents';
import type { Agent } from '../components/AIChatPanel/types';
import type { MentionUser } from './MentionInput';

export interface MentionUserInfo {
  userId?: number;
  avatar?: string;
  name: string;
  type: 'agent' | 'user';
  icon?: string;
  /** Accent color (hex) — used to tint mention pills/avatars */
  color?: string;
  description?: string;
  model?: string;
  isActive?: boolean;
}

interface MentionUsersContextValue {
  spaceId?: number;
  getBySlug: (slug: string) => MentionUserInfo | null;
  getByUserId: (id: number) => MentionUserInfo | null;
  getByAgentId: (id: number) => MentionUserInfo | null;
}

const MentionUsersCtx = createContext<MentionUsersContextValue>({
  getBySlug: () => null,
  getByUserId: () => null,
  getByAgentId: () => null,
});

function agentToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

interface DirectoryUser {
  id: number;
  name: string;
  avatar?: string | null;
  managed_by_agent_row_id?: number | null;
  agent_icon?: string | null;
  agent_color?: string | null;
  color?: string | null;
}

interface MentionUsersProviderProps {
  spaceId?: number;
  agents: Agent[];
  mentionUsers?: MentionUser[];
  children: React.ReactNode;
}

export const MentionUsersProvider: React.FC<MentionUsersProviderProps> = ({ agents, mentionUsers, spaceId, children }) => {
  // Identity is global; eligibility to invoke stays in the space-scoped pickers.
  const { data: users = [] } = useQuery({
    queryKey: ['chat-all-users'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: DirectoryUser[] }>('/users');
      if (!response.success) throw new Error('Unable to load user identities');
      return response.data;
    },
    staleTime: 60_000,
  });
  const { data: directoryAgents = [] } = useQuery({
    queryKey: ['mention-agent-directory'],
    queryFn: () => fetchAllAgents<Agent>('/ai/agents'),
    staleTime: 60_000,
  });
  const { slugMap, userMap, agentMap } = useMemo(() => {
    const map = new Map<string, MentionUserInfo>();
    const localIds = new Set(agents.map(agent => agent.id));
    const linkedIds = new Set(users.map(user => user.managed_by_agent_row_id));
    // Slugs can repeat across spaces. Prefer this space, then the user-linked
    // identity, so a global clone cannot replace its icon/color or hover card.
    const allAgents = [...new Map([...directoryAgents, ...agents].map(agent => [agent.id, agent])).values()]
      .sort((a, b) => Number(localIds.has(b.id)) - Number(localIds.has(a.id))
        || Number(linkedIds.has(b.id)) - Number(linkedIds.has(a.id)));
    const userMap = new Map<number, MentionUserInfo>();
    const agentMap = new Map<number, MentionUserInfo>();
    for (const agent of allAgents) {
      const slug = agent.agent_slug?.toLowerCase().replace(/_/g, '-') || agentToSlug(agent.name);
      const user = users.find(user => user.managed_by_agent_row_id === agent.id);
      const info: MentionUserInfo = {
        userId: user?.id,
        avatar: user?.avatar || undefined,
        name: agent.name,
        type: 'agent',
        icon: agent.icon || undefined,
        color: agent.color || undefined,
        description: agent.description || undefined,
        model: agent.model_name || agent.model || undefined,
        isActive: agent.is_active,
      };
      if (!map.has(slug)) map.set(slug, info);
      agentMap.set(agent.id, info);
      if (user) userMap.set(user.id, info);
    }
    // Older messages and the mention picker use slugs derived from display names.
    // Canonical slugs always win when a display-name alias collides.
    for (const agent of allAgents) {
      const alias = agentToSlug(agent.name);
      const info = agentMap.get(agent.id);
      if (info && !map.has(alias)) map.set(alias, info);
    }
    for (const user of users) {
      const info: MentionUserInfo = userMap.get(user.id) || {
        userId: user.id,
        name: user.name,
        type: user.managed_by_agent_row_id ? 'agent' : 'user',
        avatar: user.avatar || undefined,
        icon: user.agent_icon || undefined,
        color: user.color || user.agent_color || undefined,
      };
      userMap.set(user.id, info);
      if (user.managed_by_agent_row_id && !agentMap.has(user.managed_by_agent_row_id)) agentMap.set(user.managed_by_agent_row_id, info);
      const alias = agentToSlug(user.name);
      if (!map.has(alias)) map.set(alias, info);
    }
    // Passport handles identify a user globally and win over space-local aliases.
    for (const user of mentionUsers ?? []) {
      const info = userMap.get(user.id);
      if (user.handle && info) map.set(user.handle.toLowerCase().replace(/_/g, '-'), info);
    }
    return { slugMap: map, userMap, agentMap };
  }, [agents, directoryAgents, users, mentionUsers]);

  const getBySlug = useCallback(
    (slug: string): MentionUserInfo | null => {
      const normalized = slug.toLowerCase().replace(/^[@/]/, '').replace(/_/g, '-');
      return slugMap.get(normalized) || null;
    },
    [slugMap]
  );

  const getByUserId = useCallback((id: number) => userMap.get(id) || null, [userMap]);
  const getByAgentId = useCallback((id: number) => agentMap.get(id) || null, [agentMap]);
  const value = useMemo(() => ({ getBySlug, getByUserId, getByAgentId, spaceId }), [getBySlug, getByUserId, getByAgentId, spaceId]);

  return (
    <MentionUsersCtx.Provider value={value}>
      {children}
    </MentionUsersCtx.Provider>
  );
};

export const useMentionUsers = () => useContext(MentionUsersCtx);
