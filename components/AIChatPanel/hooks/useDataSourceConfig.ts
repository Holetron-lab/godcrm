/**
 * useDataSourceConfig — Manages tasks/files source configuration.
 * Extracted from AIChatPanel.tsx (lines 1032-1192).
 */
import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { TasksSourceConfig, FilesSourceConfig } from '../../AIChatPanel.types';

interface UseDataSourceConfigParams {
  effectiveSpaceId: number | string | undefined;
  currentSpace: { id?: number | string; tickets_config?: TasksSourceConfig | null; files_config?: FilesSourceConfig | null; settings?: unknown } | null;
  allTablesDataMain: { spacesWithTables?: Array<{ id: number | string; projects: Array<{ id: number; name: string; tables?: Array<{ id: number | string; name?: string; displayName?: string; icon?: string }> }> }> } | null | undefined;
  setTasksSource: (config: TasksSourceConfig | undefined) => void;
  setFilesSource: (config: FilesSourceConfig | undefined) => void;
  setDefaultAgentId: (id: number | null) => void;
  setQuickEmojis: (emojis: string[]) => void;
}

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

export function useDataSourceConfig({
  effectiveSpaceId,
  currentSpace,
  allTablesDataMain,
  setTasksSource,
  setFilesSource,
  setDefaultAgentId,
  setQuickEmojis,
}: UseDataSourceConfigParams) {
  const queryClient = useQueryClient();

  // Load tasksSource from space.tickets_config when space changes
  useEffect(() => {
    const spaceId = effectiveSpaceId;
    if (!spaceId) return;
    setTasksSource(undefined);
    const ticketsConfig = (currentSpace as { tickets_config?: TasksSourceConfig | null })?.tickets_config;
    if (ticketsConfig) {
      setTasksSource(ticketsConfig);
    } else {
      apiClient.get<{ success?: boolean; data?: { space?: { tickets_config?: TasksSourceConfig | null } } }>(`/spaces/${spaceId}`)
        .then((resp) => {
          const config = resp?.data?.space?.tickets_config;
          if (config) {
            logger.debug('[AIChatPanel] Loaded tickets_config from API:', config);
            setTasksSource(config);
          }
        })
        .catch((err) => logger.error('[AIChatPanel] Failed to load tickets_config:', err));
    }
  }, [effectiveSpaceId, currentSpace]);

  // Save tasksSource to server
  const saveTasksSourceToServer = useCallback(async (config: TasksSourceConfig | undefined) => {
    const spaceId = effectiveSpaceId;
    if (!spaceId) {
      logger.warn('[AIChatPanel] saveTasksSourceToServer: no spaceId, skipping');
      return;
    }
    logger.debug('[AIChatPanel] Saving tickets_config to space', spaceId, config);
    try {
      const result = await apiClient.patch(`/spaces/${spaceId}`, { tickets_config: config || null });
      logger.debug('[AIChatPanel] tickets_config saved OK:', result);
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
    } catch (err) {
      logger.error('[AIChatPanel] Failed to save tickets_config:', err);
    }
  }, [effectiveSpaceId, queryClient]);

  const updateTasksSource = useCallback((config: TasksSourceConfig | undefined) => {
    setTasksSource(config);
    saveTasksSourceToServer(config);
  }, [saveTasksSourceToServer, setTasksSource]);

  // Load filesSource from space.files_config when space changes
  useEffect(() => {
    const spaceId = effectiveSpaceId;
    if (!spaceId) return;
    setFilesSource(undefined);
    const filesConfig = (currentSpace as { files_config?: FilesSourceConfig | null })?.files_config;
    if (filesConfig) {
      setFilesSource(filesConfig);
    } else {
      apiClient.get<{ success?: boolean; data?: { space?: { files_config?: FilesSourceConfig | null } } }>(`/spaces/${spaceId}`)
        .then((resp) => {
          const config = resp?.data?.space?.files_config;
          if (config) {
            logger.debug('[AIChatPanel] Loaded files_config from API:', config);
            setFilesSource(config);
          } else {
            // Auto-mapping: try to find Files table in System Data project
            if (allTablesDataMain?.spacesWithTables) {
              const currentSpaceData = allTablesDataMain.spacesWithTables.find(s => s.id === spaceId);
              if (currentSpaceData) {
                const systemDataProject = currentSpaceData.projects.find(p =>
                  p.name.toLowerCase().includes('system data') ||
                  p.name.toLowerCase().includes('системные')
                );
                if (systemDataProject) {
                  const filesTable = systemDataProject.tables?.find(t =>
                    (t.name?.toLowerCase() === 'files' || t.displayName?.toLowerCase() === 'files') ||
                    (t.name?.toLowerCase().includes('файл') || t.displayName?.toLowerCase().includes('файл'))
                  );
                  if (filesTable) {
                    const autoConfig = {
                      tableId: Number(filesTable.id),
                      tableName: filesTable.displayName || filesTable.name || 'Files',
                      tableIcon: filesTable.icon || '📁',
                      projectId: systemDataProject.id
                    };
                    setFilesSource(autoConfig);
                    apiClient.patch(`/spaces/${spaceId}`, { files_config: autoConfig })
                      .catch((err) => logger.error('[AIChatPanel] Failed to save auto-mapped files_config:', err));
                  }
                }
              }
            }
          }
        })
        .catch((err) => logger.error('[AIChatPanel] Failed to load files_config:', err));
    }
  }, [effectiveSpaceId, currentSpace, allTablesDataMain]);

  // Save filesSource to server
  const saveFilesSourceToServer = useCallback(async (config: FilesSourceConfig | undefined) => {
    const spaceId = effectiveSpaceId;
    if (!spaceId) {
      logger.warn('[AIChatPanel] saveFilesSourceToServer: no spaceId, skipping');
      return;
    }
    logger.debug('[AIChatPanel] Saving files_config to space', spaceId, config);
    try {
      const result = await apiClient.patch(`/spaces/${spaceId}`, { files_config: config || null });
      logger.debug('[AIChatPanel] files_config saved OK:', result);
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
    } catch (err) {
      logger.error('[AIChatPanel] Failed to save files_config:', err);
    }
  }, [effectiveSpaceId, queryClient]);

  const updateFilesSource = useCallback((config: FilesSourceConfig | undefined) => {
    setFilesSource(config);
    const spaceId = effectiveSpaceId;
    if (spaceId) {
      if (config) {
        localStorage.setItem(`chat-files-source-${spaceId}`, JSON.stringify(config));
      } else {
        localStorage.removeItem(`chat-files-source-${spaceId}`);
      }
    }
    saveFilesSourceToServer(config);
  }, [saveFilesSourceToServer, effectiveSpaceId, setFilesSource]);

  // Load default agent from space settings
  useEffect(() => {
    if (currentSpace?.settings && typeof currentSpace.settings === 'object') {
      const spaceSettings = currentSpace.settings as Record<string, unknown>;
      if (spaceSettings.default_agent_id) {
        setDefaultAgentId(Number(spaceSettings.default_agent_id));
      } else {
        setDefaultAgentId(null);
      }
      if (spaceSettings.quick_emojis && Array.isArray(spaceSettings.quick_emojis)) {
        setQuickEmojis(spaceSettings.quick_emojis as string[]);
      } else {
        setQuickEmojis(DEFAULT_QUICK_EMOJIS);
      }
    } else {
      setDefaultAgentId(null);
      setQuickEmojis(DEFAULT_QUICK_EMOJIS);
    }
  }, [currentSpace?.id, currentSpace?.settings]);

  return {
    updateTasksSource,
    updateFilesSource,
    DEFAULT_QUICK_EMOJIS,
  };
}
