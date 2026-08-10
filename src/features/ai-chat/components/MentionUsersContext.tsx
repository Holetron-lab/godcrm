/**
 * MentionUsersContext — provides slug→agent/user lookup for MentionTooltip
 */

import React, { createContext, useContext, useMemo, useCallback } from 'react';
import type { Agent } from '../components/AIChatPanel/types';

export interface MentionUserInfo {
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
  getBySlug: (slug: string) => MentionUserInfo | null;
}

const MentionUsersCtx = createContext<MentionUsersContextValue>({
  getBySlug: () => null,
});

function agentToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

interface MentionUsersProviderProps {
  agents: Agent[];
  children: React.ReactNode;
}

export const MentionUsersProvider: React.FC<MentionUsersProviderProps> = ({ agents, children }) => {
  const slugMap = useMemo(() => {
    const map = new Map<string, MentionUserInfo>();
    for (const agent of agents) {
      const slug = agentToSlug(agent.name);
      map.set(slug, {
        name: agent.name,
        type: 'agent',
        icon: agent.icon || undefined,
        color: agent.color || undefined,
        description: agent.description || undefined,
        model: agent.model_name || agent.model || undefined,
        isActive: agent.is_active,
      });
    }
    return map;
  }, [agents]);

  const getBySlug = useCallback(
    (slug: string): MentionUserInfo | null => {
      const normalized = slug.toLowerCase().replace(/^[@/]/, '');
      return slugMap.get(normalized) || null;
    },
    [slugMap]
  );

  const value = useMemo(() => ({ getBySlug }), [getBySlug]);

  return (
    <MentionUsersCtx.Provider value={value}>
      {children}
    </MentionUsersCtx.Provider>
  );
};

export const useMentionUsers = () => useContext(MentionUsersCtx);
