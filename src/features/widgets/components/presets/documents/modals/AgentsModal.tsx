/**
 * Agents Modal - Select AI agents for embeddings and translations
 * Uses cascade selection: Space -> Project -> Table -> Agent
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Save,
  RefreshCw,
  Loader2,
  Database,
  Table2,
} from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Select } from '@/shared/components/ui/Select';
import { useAllTables } from '@/features/tables/hooks/useAllTables';

export function AgentsModal() {
  const ctx = useDocumentsContext();

  // Table selection state
  const { data: allTablesData } = useAllTables();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  // Agents from selected table
  const [agents, setAgents] = useState<Array<{ id: number; name: string; type: string; model: string; icon?: string }>>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  // Selected agents
  const [selectedEmbeddingAgent, setSelectedEmbeddingAgent] = useState<number | null>(null);
  const [selectedTranslationAgent, setSelectedTranslationAgent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Create tables state
  const [creatingTables, setCreatingTables] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Auto-mapping flag
  const [autoMapped, setAutoMapped] = useState(false);

  // Get tables for selected project
  const projectTables = useMemo(() => {
    if (!selectedProjectId || !allTablesData?.projects) return [];
    const project = allTablesData.projects.find(p => p.id === selectedProjectId);
    return project?.tables || [];
  }, [selectedProjectId, allTablesData]);

  // Auto-mapping: find AI Agents table automatically
  useEffect(() => {
    if (autoMapped || !allTablesData?.projects || selectedTableId) return;

    // First check widget config (most reliable)
    const widgetConfig = ctx.config;
    const aiConfig = widgetConfig?.ai_agents_config || widgetConfig;
    if (aiConfig?.agents_table_id) {
      for (const proj of allTablesData.projects) {
        const table = proj.tables.find(t => String(t.id) === String(aiConfig.agents_table_id));
        if (table) {
          setSelectedProjectId(proj.id);
          setSelectedTableId(Number(aiConfig.agents_table_id));
          if (aiConfig.embedding_agent_id) setSelectedEmbeddingAgent(Number(aiConfig.embedding_agent_id));
          if (aiConfig.translation_agent_id) setSelectedTranslationAgent(Number(aiConfig.translation_agent_id));
          setAutoMapped(true);
          return;
        }
      }
    }

    // Fallback: check localStorage
    const saved = localStorage.getItem(`documents-agents-${ctx.widgetId}`);
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.agents_table_id) {
          for (const proj of allTablesData.projects) {
            const table = proj.tables.find(t => String(t.id) === String(settings.agents_table_id));
            if (table) {
              setSelectedProjectId(proj.id);
              setSelectedTableId(Number(settings.agents_table_id));
              if (settings.embedding_agent_id) setSelectedEmbeddingAgent(settings.embedding_agent_id);
              if (settings.translation_agent_id) setSelectedTranslationAgent(settings.translation_agent_id);
              setAutoMapped(true);
              return;
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to load saved settings:', e);
      }
    }

    // Auto-find table with key "ai_agents" in System Data project
    for (const proj of allTablesData.projects) {
      if (proj.name === 'System Data') {
        const agentsTable = proj.tables.find(t => t.name === 'ai_agents');
        if (agentsTable) {
          setSelectedProjectId(proj.id);
          setSelectedTableId(Number(agentsTable.id));
          setAutoMapped(true);
          return;
        }
      }
    }

    // Fallback: any table with key "ai_agents"
    for (const proj of allTablesData.projects) {
      const agentsTable = proj.tables.find(t => t.name === 'ai_agents');
      if (agentsTable) {
        setSelectedProjectId(proj.id);
        setSelectedTableId(Number(agentsTable.id));
        setAutoMapped(true);
        return;
      }
    }

    setAutoMapped(true);
  }, [allTablesData, ctx.widgetId, selectedTableId, autoMapped]);

  // Load agents from selected table
  useEffect(() => {
    if (!selectedTableId) {
      setAgents([]);
      return;
    }

    const loadAgentsFromTable = async () => {
      setLoadingAgents(true);
      try {
        const result = await apiClient.get<{
          success: boolean;
          data: { rows: Array<{ id: number; data: Record<string, unknown> }> }
        }>(`/tables/${selectedTableId}/rows?limit=100`);

        const rows = result.data?.rows || [];
        if (rows.length > 0) {
          const parsedAgents = rows.map(row => {
            const d = row.data || {};
            return {
              id: row.id,
              name: String(d.name || d.agent_name || 'Unnamed'),
              type: String(d.agent_type || d.type || 'chat'),
              model: String(d.model || 'unknown'),
              icon: String(d.icon || '🤖'),
            };
          });
          setAgents(parsedAgents);

          // Restore saved agent selections after agents are loaded
          const saved = localStorage.getItem(`documents-agents-${ctx.widgetId}`);
          if (saved) {
            try {
              const settings = JSON.parse(saved);
              if (settings.embedding_agent_id && parsedAgents.some(a => a.id === settings.embedding_agent_id)) {
                setSelectedEmbeddingAgent(settings.embedding_agent_id);
              }
              if (settings.translation_agent_id && parsedAgents.some(a => a.id === settings.translation_agent_id)) {
                setSelectedTranslationAgent(settings.translation_agent_id);
              }
            } catch (e) {
              logger.warn('Failed to restore agent selections:', e);
            }
          }
        } else {
          setAgents([]);
        }
      } catch (error) {
        logger.error('Failed to load agents from table:', error);
        setAgents([]);
      } finally {
        setLoadingAgents(false);
      }
    };

    loadAgentsFromTable();
  }, [selectedTableId, ctx.widgetId]);

  // Create AI tables
  const handleCreateTables = async () => {
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    if (!ctx.spaceId) {
      setCreateError('Нет выбранного пространства');
      return;
    }

    setCreatingTables(true);
    setCreateError(null);
    try {
      const result = await apiClient.post<{ success: boolean; error?: string }>('/ai/setup-tables', {
        spaceId: ctx.spaceId
      });

      if (!result.success) {
        setCreateError(result.error || 'Ошибка создания таблиц');
      }
    } catch (error) {
      logger.error('Failed to create tables:', error);
      setCreateError('Ошибка подключения');
    } finally {
      setCreatingTables(false);
    }
  };

  const embeddingAgents = agents.filter(a => a.type === 'embedding' || a.name.toLowerCase().includes('embed'));
  const translationAgents = agents.filter(a => a.type === 'translation' || a.type === 'chat' || a.type === 'completion' || a.name.toLowerCase().includes('translat'));

  const handleSave = async () => {
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    setSaving(true);
    try {
      const settings = {
        agents_table_id: selectedTableId,
        embedding_agent_id: selectedEmbeddingAgent,
        translation_agent_id: selectedTranslationAgent,
      };

      // Save to localStorage as backup
      localStorage.setItem(`documents-agents-${ctx.widgetId}`, JSON.stringify(settings));

      // Save to widget config via API - merge with existing config
      if (ctx.widgetId && ctx.config) {
        try {
          const existingConfig = ctx.config ?? {};
          await apiClient.patch(`/widgets/${ctx.widgetId}`, {
            config: {
              ...existingConfig,
              ...settings,
              ai_agents_config: settings
            }
          });
        } catch (e) {
          logger.warn('Failed to save to widget config:', e);
        }

        // Update used_in_widgets field in agent rows
        const agentIds = [selectedEmbeddingAgent, selectedTranslationAgent].filter(Boolean);
        for (const agentId of agentIds) {
          try {
            // Get current agent data
            const agentRow = agents.find(a => a.id === agentId);
            if (agentRow && selectedTableId) {
              const currentData = await apiClient.get<{ data: { data: Record<string, unknown> } }>(`/tables/${selectedTableId}/rows/${agentId}`);
              const existingWidgets: number[] = (currentData.data?.data?.used_in_widgets as number[]) || [];
              if (!existingWidgets.includes(ctx.widgetId)) {
                await apiClient.patch(`/tables/${selectedTableId}/rows/${agentId}`, {
                  data: {
                    used_in_widgets: [...existingWidgets, ctx.widgetId]
                  }
                });
              }
            }
          } catch (e) {
            logger.warn('Failed to update agent used_in_widgets:', e);
          }
        }
      }

      ctx.setShowAgentsModal(false);
    } catch (error) {
      logger.error('Failed to save agents:', error);
    } finally {
      setSaving(false);
    }
  };

  // Get selected table info for key display
  const selectedTableInfo = projectTables.find(t => String(t.id) === String(selectedTableId));

  return (
    <Modal
      open={ctx.showAgentsModal}
      onOpenChange={(open) => ctx.setShowAgentsModal(open)}
      title="Настройка AI агентов"
      size="md"
      footer={
        <div className="flex items-center gap-3 w-full">
          <Button
            onClick={() => ctx.setShowAgentsModal(false)}
            variant="secondary"
          >
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="primary"
            className="flex-1"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Table Selection */}
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Таблица агентов</span>
          </div>

          <div className="space-y-3">
            {/* Project Selection */}
            <Select
              label="Проект"
              value={selectedProjectId ? String(selectedProjectId) : '__none__'}
              onChange={(value) => {
                const projId = value === '__none__' ? null : Number(value);
                setSelectedProjectId(projId);
                setSelectedTableId(null);
                setAgents([]);
              }}
              options={[{ label: '— Выберите проект —', value: '__none__' }]}
              groups={(allTablesData?.spaces || []).map((space) => ({
                label: `${space.icon || '🏢'} ${space.name} (${space.id})`,
                options: space.projects.map((p) => ({
                  label: `${p.icon || '📂'} ${p.name} (${p.id})`,
                  value: String(p.id)
                }))
              }))}
            />

            {/* Table Selection */}
            <Select
              label="Таблица"
              value={selectedTableId ? String(selectedTableId) : '__none__'}
              onChange={(value) => {
                const tableId = value === '__none__' ? null : Number(value);
                setSelectedTableId(tableId);
              }}
              disabled={!selectedProjectId}
              options={[
                { label: '— Выберите таблицу —', value: '__none__' },
                ...projectTables.map((t) => ({
                  label: `${t.icon || '📋'} ${t.displayName || t.name} (${t.id}) ${t.name}`,
                  value: String(t.id)
                }))
              ]}
            />
            {selectedTableInfo && (
              <a
                href={`/tables/${selectedTableId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--accent-primary)] hover:underline mt-1 inline-block"
              >
                Открыть таблицу агентов →
              </a>
            )}
          </div>

          {!selectedTableId && (
            <p className="text-xs text-[var(--text-tertiary)] mt-2">
              Выберите таблицу, в которой хранятся AI агенты
            </p>
          )}
        </div>

        {loadingAgents ? (
          <div className="text-center py-6">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[var(--text-tertiary)]" />
            <p className="text-sm text-[var(--text-tertiary)] mt-2">Загрузка агентов...</p>
          </div>
        ) : selectedTableId && agents.length > 0 ? (
          <>
            {/* Embedding Agent */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                🔍 Агент для эмбеддингов
              </label>
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                Используется для векторного поиска по содержимому документов
              </p>
              <select
                value={selectedEmbeddingAgent || ''}
                onChange={(e) => setSelectedEmbeddingAgent(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm"
              >
                <option value="">Не выбран</option>
                {(embeddingAgents.length > 0 ? embeddingAgents : agents).map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.icon} {agent.name} ({agent.model}) [ID: {agent.id}]
                  </option>
                ))}
              </select>
            </div>

            {/* Translation Agent */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                🌐 Агент для переводов
              </label>
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                Используется для автоматического перевода контента между языками
              </p>
              <select
                value={selectedTranslationAgent || ''}
                onChange={(e) => setSelectedTranslationAgent(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm"
              >
                <option value="">Не выбран</option>
                {(translationAgents.length > 0 ? translationAgents : agents).map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.icon} {agent.name} ({agent.model}) [ID: {agent.id}]
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : selectedTableId ? (
          <div className="text-center py-6 text-[var(--text-tertiary)]">
            <p className="text-sm">В выбранной таблице нет агентов</p>
          </div>
        ) : null}

        {/* Create Tables - only show if no table selected */}
        {!selectedTableId && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <p className="text-sm text-yellow-400 mb-3">
              Для работы с AI агентами нужно выбрать таблицу агентов выше, или создать новые AI таблицы в текущем пространстве.
            </p>
            <Button
              onClick={handleCreateTables}
              disabled={creatingTables || !ctx.spaceId}
              variant="primary"
              size="sm"
            >
              {creatingTables ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Создание таблиц...
                </>
              ) : (
                <>
                  <Table2 className="w-4 h-4 mr-2" />
                  Создать AI таблицы
                </>
              )}
            </Button>
            {createError && (
              <p className="text-sm text-red-400 mt-2">{createError}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
