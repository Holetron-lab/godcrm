import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { AIAgent } from '../../../types';

interface AgentSettingsOptions {
  currentConversationId: number | null;
  userConversationId: number | null;
  contextSpaceId: number | undefined;
  agents: AIAgent[];
  setDefaultAgentId: (id: number | null) => void;
  setQuickEmojis: (emojis: string[]) => void;
}

// spaces.settings can arrive as a JSON string (API refetch) or an object
// (optimistic store update) — normalize both to a plain object. (ADR-185)
function parseSpaceSettings(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

export function useChatAgentSettings({ currentConversationId, userConversationId, contextSpaceId, agents, setDefaultAgentId, setQuickEmojis }: AgentSettingsOptions) {
  // Bind agent settings to the panel's EFFECTIVE space (contextSpaceId), not the
  // global currentSpace. In a Direct/DM panel currentSpace is null while the panel
  // is still space-scoped — reading currentSpace silently no-op'd both hydrate and
  // save, so the agent dropdowns showed "— Не выбран —" and selects never persisted
  // (no PUT fired). Subscribe to whichever space actually owns the settings. (ADR-185)
  const effectiveSpace = useSpacesStore(state => {
    const sid = contextSpaceId ?? state.currentSpace?.id;
    if (sid == null) return null;
    return state.currentSpace?.id === sid ? state.currentSpace : (state.spaces.find(s => s.id === sid) ?? null);
  });
  const [summaryAgentId, setSummaryAgentId] = useState<number | null>(null);
  const [isSavingSummaryAgent, setIsSavingSummaryAgent] = useState(false);
  // ADR-185 — dedicated translation agent, distinct from the default (auto-respond)
  // agent. Persisted space-wide in spaces.settings.translation_agent_id.
  const [translationAgentId, setTranslationAgentId] = useState<number | null>(null);
  const [isSavingTranslationAgent, setIsSavingTranslationAgent] = useState(false);

  // Save summary agent to conversation settings
  const saveSummaryAgent = useCallback(async (agentId: number | null) => {
    const convId = currentConversationId ?? userConversationId;
    if (!convId) return;
    setIsSavingSummaryAgent(true);
    try {
      await apiClient.patch(`/chat/conversations/${convId}/settings`, {
        summary_agent_id: agentId,
      });
      setSummaryAgentId(agentId);
    } catch (err) {
      logger.error('Failed to save summary agent:', err);
    } finally {
      setIsSavingSummaryAgent(false);
    }
  }, [currentConversationId, userConversationId]);

  // Save translation agent to SPACE settings (space-wide, like the default agent —
  // the backend translator resolves spaces.settings.translation_agent_id).
  const saveTranslationAgent = useCallback(async (agentId: number | null) => {
    // Read fresh store state at click time — resolve the effective space even when
    // the global currentSpace is null (DM panel), keyed by contextSpaceId. (ADR-185)
    const store = useSpacesStore.getState();
    const sid = contextSpaceId ?? store.currentSpace?.id;
    if (sid == null) return;
    setIsSavingTranslationAgent(true);
    try {
      const space = store.currentSpace?.id === sid ? store.currentSpace : store.getSpaceById(sid);
      const newSettings = { ...parseSpaceSettings(space?.settings), translation_agent_id: agentId };
      await apiClient.put(`/spaces/${sid}`, { settings: newSettings });
      setTranslationAgentId(agentId);
      if (store.currentSpace?.id === sid) store.setCurrentSpace({ ...store.currentSpace, settings: newSettings });
      store.updateSpace(sid, { settings: newSettings });
    } catch (err) {
      logger.error('Failed to save translation agent:', err);
    } finally {
      setIsSavingTranslationAgent(false);
    }
  }, [contextSpaceId]);

  useEffect(() => {
    // Hydrate the agent dropdowns from the EFFECTIVE space's settings (see
    // effectiveSpace above), parsing string-or-object. The old code read
    // currentSpace — null in DM panels — so both dropdowns reset to
    // "— Не выбран —" even when the space had agents saved. (ADR-185)
    const s = parseSpaceSettings(effectiveSpace?.settings);
    setDefaultAgentId(s.default_agent_id ? Number(s.default_agent_id) : null);
    setTranslationAgentId(s.translation_agent_id ? Number(s.translation_agent_id) : null);
    setQuickEmojis(Array.isArray(s.quick_emojis) ? s.quick_emojis as string[] : ['👍','❤️','😂','🔥','💯','🙏','😍','😮']);
  }, [effectiveSpace?.id, effectiveSpace?.settings, setDefaultAgentId, setQuickEmojis]);

  // Auto-map summary agent by name "Summary" when agents load
  useEffect(() => {
    if (agents.length > 0 && !summaryAgentId) {
      const summaryAgent = agents.find(a => a.name.toLowerCase().includes('summary'));
      if (summaryAgent) setSummaryAgentId(summaryAgent.id);
    }
  }, [agents, summaryAgentId]);

  return { effectiveSpace, summaryAgentId, isSavingSummaryAgent, saveSummaryAgent, translationAgentId, isSavingTranslationAgent, saveTranslationAgent };
}
