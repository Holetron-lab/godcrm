/**
 * useAgentSettings — Agent configuration persistence (save settings, default agent, emojis).
 * Extracted from AIChatPanel.tsx (lines 714-830).
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { ContextSettings } from '../types';

interface UseAgentSettingsParams {
  currentAgent: { id: number; provider_id?: number; operator_id?: number; model?: string; system_prompt?: string } | null;
  currentSpace: { id?: number | string; settings?: unknown } | null;
  loadAgents: () => void;
  chatOperatorId: number | null;
  chatModelId: string;
  chatSystemPrompt: string;
  setIsSavingAgentSettings: (saving: boolean) => void;
  setDefaultAgentId: (id: number | null) => void;
  setIsSavingDefaultAgent: (saving: boolean) => void;
  setQuickEmojis: (emojis: string[]) => void;
  setIsSavingEmojis: (saving: boolean) => void;
  contextSettings: ContextSettings | string | undefined | null;
  setContextSettings: (settings: ContextSettings | string | undefined | null) => void;
  setIsSavingContextSettings: (saving: boolean) => void;
  isAdminOrOwner: boolean;
}

export function useAgentSettings({
  currentAgent,
  currentSpace,
  loadAgents,
  chatOperatorId,
  chatModelId,
  chatSystemPrompt,
  setIsSavingAgentSettings,
  setDefaultAgentId,
  setIsSavingDefaultAgent,
  setQuickEmojis,
  setIsSavingEmojis,
  setContextSettings,
  setIsSavingContextSettings,
}: UseAgentSettingsParams) {
  const queryClient = useQueryClient();
  const updateSpaceInStore = useSpacesStore(state => state.updateSpace);
  const setCurrentSpaceInStore = useSpacesStore(state => state.setCurrentSpace);

  // Save agent settings mutation
  const saveAgentSettings = useCallback(async () => {
    if (!currentAgent) return;
    setIsSavingAgentSettings(true);
    try {
      await apiClient.put(`/ai/agents/${currentAgent.id}`, {
        provider_id: chatOperatorId,
        model: chatModelId,
        system_prompt: chatSystemPrompt
      });
      loadAgents();
    } catch (error) {
      logger.error('Failed to save agent settings:', error);
    } finally {
      setIsSavingAgentSettings(false);
    }
  }, [currentAgent, chatOperatorId, chatModelId, chatSystemPrompt, loadAgents, setIsSavingAgentSettings]);

  // Save context settings to agent
  const saveContextSettings = useCallback(async (settings: ContextSettings) => {
    if (!currentAgent) return;
    setIsSavingContextSettings(true);
    try {
      await apiClient.put(`/ai/agents/${currentAgent.id}`, {
        context_settings: JSON.stringify(settings),
      });
      setContextSettings(settings);
      loadAgents();
    } catch (error) {
      logger.error('Failed to save context settings:', error);
    } finally {
      setIsSavingContextSettings(false);
    }
  }, [currentAgent, loadAgents, setContextSettings, setIsSavingContextSettings]);

  const handleContextSettingsChange = useCallback((settings: ContextSettings) => {
    setContextSettings(settings);
  }, [setContextSettings]);

  // Save default agent to space settings
  const saveDefaultAgent = useCallback(async (agentId: number | null) => {
    if (!currentSpace?.id) return;
    setIsSavingDefaultAgent(true);
    try {
      const currentSettings = (currentSpace?.settings as Record<string, unknown>) || {};
      const newSettings = { ...currentSettings, default_agent_id: agentId };

      await apiClient.put(`/spaces/${currentSpace.id}`, { settings: newSettings });
      setDefaultAgentId(agentId);

      if (currentSpace) {
        setCurrentSpaceInStore({ ...currentSpace, settings: newSettings } as typeof currentSpace & { id: number | string });
        updateSpaceInStore(currentSpace.id as number, { settings: newSettings } as Partial<typeof currentSpace>);
      }

      queryClient.invalidateQueries({ queryKey: ['spaces', 'detail', currentSpace.id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } catch (error) {
      logger.error('Failed to save default agent:', error);
    } finally {
      setIsSavingDefaultAgent(false);
    }
  }, [currentSpace, setDefaultAgentId, setIsSavingDefaultAgent, queryClient, updateSpaceInStore, setCurrentSpaceInStore]);

  // Save quick emojis to space settings
  const saveQuickEmojis = useCallback(async (emojis: string[]) => {
    if (!currentSpace?.id) return;
    setIsSavingEmojis(true);
    try {
      const currentSettings = (currentSpace?.settings as Record<string, unknown>) || {};
      const newSettings = { ...currentSettings, quick_emojis: emojis.slice(0, 10) };

      await apiClient.put(`/spaces/${currentSpace.id}`, { settings: newSettings });
      setQuickEmojis(emojis.slice(0, 10));

      if (currentSpace) {
        setCurrentSpaceInStore({ ...currentSpace, settings: newSettings } as typeof currentSpace & { id: number | string });
        updateSpaceInStore(currentSpace.id as number, { settings: newSettings } as Partial<typeof currentSpace>);
      }

      queryClient.invalidateQueries({ queryKey: ['spaces', 'detail', currentSpace.id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } catch (error) {
      logger.error('Failed to save quick emojis:', error);
    } finally {
      setIsSavingEmojis(false);
    }
  }, [currentSpace, setQuickEmojis, setIsSavingEmojis, queryClient, updateSpaceInStore, setCurrentSpaceInStore]);

  return {
    saveAgentSettings,
    saveContextSettings,
    handleContextSettingsChange,
    saveDefaultAgent,
    saveQuickEmojis,
  };
}
