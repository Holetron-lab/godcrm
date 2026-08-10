import React, { useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { Input } from '@/shared/components/ui';
import { ColumnSettingsProps, renderTypeCellPreview } from './types';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { apiClient } from '@/shared/utils/apiClient';

interface EmbeddingAgent {
  id: number;
  name: string;
  model: string;
  icon?: string;
  color?: string;
}

/**
 * Компонент настроек для колонок типа vector
 */
export const VectorColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  const [agents, setAgents] = useState<EmbeddingAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const currentSpace = useCurrentSpace();

  // Load embedding agents
  useEffect(() => {
    const loadAgents = async () => {
      try {
        setLoading(true);
        const params = currentSpace?.id ? `?spaceId=${currentSpace.id}` : '';
        const response = await apiClient.get<{ success: boolean; agents: EmbeddingAgent[] }>(
          `/ai/vector/agents${params}`
        );
        if (response.success && response.agents) {
          setAgents(response.agents);
        }
      } catch (error) {
        logger.error('Failed to load embedding agents:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAgents();
  }, [currentSpace?.id]);

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        ✨ Настройки вектора
      </h4>

      {/* Agent selector */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
          🤖 Агент для эмбеддингов
        </label>
        <select
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          value={draft.config?.vector?.agent_id ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              vector: { 
                ...prev.config?.vector, 
                agent_id: event.target.value ? Number(event.target.value) : undefined 
              }
            }
          }))}
          disabled={loading}
        >
          <option value="">🔧 Авто (системный агент)</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.icon || '🧮'} {agent.name} ({agent.model})
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Агент определяет API ключ и модель для генерации эмбеддингов
        </p>
      </div>

      <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-sm border border-orange-200 dark:border-orange-800">
        <p className="text-orange-600 dark:text-orange-300">
          💡 Используйте <code className="bg-orange-100 dark:bg-orange-800 px-1 rounded">{'{{column_name}}'}</code> для подстановки значений из других колонок
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
          Формула (необязательно)
        </label>
        <textarea
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] resize-y min-h-[80px] font-mono text-sm"
          placeholder={`{{title}} {{articul}}
{{description}}
Категория: {{category_id}}
Бренд: {{brand_id}}`}
          value={draft.config?.vector?.formula ?? ''}
          onChange={(event) => setDraft(prev => ({
            ...prev,
            config: {
              ...prev.config,
              vector: { ...prev.config?.vector, formula: event.target.value || undefined }
            }
          }))}
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Используйте {'{{column_name}}'} для подстановки значений. Если не указана, используются все видимые колонки
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input
            label="Префикс"
            placeholder="📄 "
            value={draft.config?.vector?.prefix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                vector: { ...prev.config?.vector, prefix: event.target.value || undefined }
              }
            }))}
          />
        </div>

        <div>
          <Input
            label="Суффикс"
            placeholder=" (векторизовано)"
            value={draft.config?.vector?.suffix ?? ''}
            onChange={(event) => setDraft(prev => ({
              ...prev,
              config: {
                ...prev.config,
                vector: { ...prev.config?.vector, suffix: event.target.value || undefined }
              }
            }))}
          />
        </div>
      </div>

      {(draft.config?.vector?.formula || draft.config?.vector?.prefix || draft.config?.vector?.suffix) && (
        <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Превью результата:</p>
          <p className="text-sm text-[var(--text-primary)] font-mono">
            {draft.config?.vector?.prefix || ''}
            {draft.config?.vector?.formula ? '[формула]' : '[все колонки]'}
            {draft.config?.vector?.suffix || ''}
          </p>
        </div>
      )}

      {/* Selected agent info */}
      {draft.config?.vector?.agent_id && (
        <div className="p-3 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg text-sm border border-cyan-200 dark:border-cyan-800">
          <p className="text-cyan-600 dark:text-cyan-300">
            ✅ Используется агент #{draft.config.vector.agent_id}
          </p>
        </div>
      )}
    </div>
  );
};
