/** AgentsPanelContent — ADR-119 extracted from usePanelContent.tsx
 *
 * Layout (unified with ContactsPanelContent):
 *   header row 1: [🔍 search...]   [⭐] [🧠 AI] [filter]
 *   header row 2: [status select] [provider select]   ← only when filter open
 *   row body: [color-bar | avatar | (name+id+badges) / (status pill + description + footer toolbar)]
 *
 * Footer toolbar inside each row: ⭐ favorite, 👁 view, ▾ expand context
 * settings (Context Depth / Auto-Summary / Vector Memory; saved per-agent
 * via PUT /ai/agents/:id). Tapping the avatar/name selects the agent and
 * opens its chat — that replaces the previous explicit "new chat" button.
 */
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, Star, Loader2, Brain, Bot, Plus, ChevronDown, Filter, Eye } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { ContextSettingsSection } from '../../components/ChatPanels/ContextSettingsSection';
import type { ContextSettings } from '../../types';
import type { PanelContentDeps } from './PanelContentTypes';
import type { AIAgent } from '../../../../types';

const RowViewerModal = lazy(() => import('../../components/ChatMessages/RowViewerModal'));

export function AgentsPanelContent(d: PanelContentDeps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [viewAgent, setViewAgent] = useState<AIAgent | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<number | null>(null);

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (providerFilter !== 'all' ? 1 : 0);

  const filteredAgents = useMemo(() => {
    let list = d.filteredAgents;
    if (statusFilter !== 'all') {
      list = list.filter(a => (statusFilter === 'active' ? a.is_active : !a.is_active));
    }
    if (providerFilter !== 'all') {
      list = list.filter(a => String(a.operator_id ?? a.provider_id ?? '') === providerFilter);
    }
    return list;
  }, [d.filteredAgents, statusFilter, providerFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Header row 1 */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={d.agentsSearch}
              onChange={(e) => { d.setAgentsSearch(e.target.value); if (!e.target.value) d.setVectorSearchResults(null); }}
              placeholder="Поиск агентов..."
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            {d.agentsSearch && (
              <button onClick={() => { d.setAgentsSearch(''); d.setVectorSearchResults(null); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded">
                <X className="w-3 h-3 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => d.setShowFavoriteAgents(!d.showFavoriteAgents)}
            title={d.showFavoriteAgents ? 'Показать всех' : 'Только избранные'}
            className={cn(
              'p-1 rounded transition-colors',
              d.showFavoriteAgents ? 'bg-yellow-500/20 text-yellow-500' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <Star className={cn('w-3.5 h-3.5', d.showFavoriteAgents && 'fill-current')} />
          </button>
          <button
            type="button"
            onClick={d.handleVectorSearch}
            disabled={d.isVectorSearching || !d.agentsSearch}
            title={d.vectorSearchResults ? 'AI поиск активен' : 'Семантический поиск'}
            className={cn(
              'p-1 rounded transition-colors',
              d.vectorSearchResults
                ? 'bg-green-500/20 text-green-400'
                : 'text-[var(--text-tertiary)] hover:text-purple-400',
              (!d.agentsSearch || d.isVectorSearching) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {d.isVectorSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            title={filtersOpen ? 'Скрыть фильтры' : 'Показать фильтры'}
            className={cn(
              'relative p-1 rounded transition-colors',
              activeFilterCount > 0 || filtersOpen
                ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-[var(--color-primary-500)] text-[9px] text-white flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Header row 2: filter selects */}
      {filtersOpen && (
        <div className="px-3 py-1.5 border-b border-[var(--border-secondary)] flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
          </select>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          >
            <option value="all">Все провайдеры</option>
            {d.operators.map(op => (
              <option key={op.id} value={String(op.id)}>{op.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filteredAgents.length === 0 ? (
          d.agentsSearch || activeFilterCount > 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Не найдено</div>
          ) : d.isLoadingAgents ? (
            <div className="py-8 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary-500)]" />
              <span className="text-sm text-[var(--text-tertiary)]">Загрузка агентов...</span>
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500/20 to-primary-500/20 flex items-center justify-center mb-4 mx-auto">
                <Bot className="w-7 h-7 text-[var(--color-primary-500)]" />
              </div>
              <h3 className="font-medium text-[var(--text-primary)] mb-2">AI агенты не настроены</h3>
              <p className="text-sm text-[var(--text-tertiary)] mb-4">Создайте AI таблицы в System Data для работы с агентами</p>
              <button onClick={() => d.createTablesMutation.mutate()} disabled={d.createTablesMutation.isPending || !d.currentSpace?.id}
                className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium mx-auto">
                {d.createTablesMutation.isPending ? (<><Loader2 className="w-4 h-4 animate-spin" />Создание...</>) : (<><Plus className="w-4 h-4" />Создать AI таблицы</>)}
              </button>
              {d.createTablesMutation.isError && <p className="text-sm text-red-500 mt-2">Ошибка создания таблиц</p>}
            </div>
          )
        ) : (
          filteredAgents.map(agent => {
            const isFavorite = d.favoriteAgents.includes(agent.id);
            const isActive = d.currentAgent?.id === agent.id;
            const isExpanded = expandedAgentId === agent.id;
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                isActive={isActive}
                isFavorite={isFavorite}
                isExpanded={isExpanded}
                isAdminOrOwner={d.isAdminOrOwner}
                onSelect={() => d.handleAgentSelect(agent)}
                onToggleFavorite={() =>
                  d.setFavoriteAgents(prev => isFavorite ? prev.filter(id => id !== agent.id) : [...prev, agent.id])
                }
                onView={() => setViewAgent(agent)}
                onToggleExpand={() => setExpandedAgentId(prev => prev === agent.id ? null : agent.id)}
              />
            );
          })
        )}
      </div>

      {viewAgent && viewAgent.table_id && (
        <Suspense fallback={null}>
          <RowViewerModal
            isOpen={!!viewAgent}
            onClose={() => setViewAgent(null)}
            tableId={viewAgent.table_id}
            rowId={viewAgent.id}
            mode="view"
          />
        </Suspense>
      )}
    </div>
  );
}

interface AgentRowProps {
  agent: AIAgent;
  isActive: boolean;
  isFavorite: boolean;
  isExpanded: boolean;
  isAdminOrOwner: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onView: () => void;
  onToggleExpand: () => void;
}

function AgentRow({ agent, isActive, isFavorite, isExpanded, isAdminOrOwner, onSelect, onToggleFavorite, onView, onToggleExpand }: AgentRowProps) {
  // Per-agent context_settings — initialized from the agent record and updated
  // on save so the row reflects the new value without waiting for a parent reload.
  const initialSettings = (agent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined;
  const [savedSettings, setSavedSettings] = useState<ContextSettings | string | undefined | null>(initialSettings);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSavedSettings((agent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined);
  }, [agent]);

  const handleSaveContextSettings = useCallback(async (settings: ContextSettings) => {
    setIsSaving(true);
    try {
      await apiClient.put(`/ai/agents/${agent.id}`, {
        context_settings: JSON.stringify(settings),
      });
      setSavedSettings(settings);
    } finally {
      setIsSaving(false);
    }
  }, [agent.id]);

  return (
    <div className="border-b border-[var(--border-secondary)] last:border-b-0">
      <div
        className={cn(
          'group px-3 py-2 transition-colors',
          isActive ? 'bg-[var(--color-primary-500)]/15' : 'hover:bg-[var(--bg-tertiary)]'
        )}
        style={agent.color ? { boxShadow: `inset 3px 0 0 0 ${agent.color}` } : undefined}
      >
        <div className="flex items-center gap-2">
          {/* Avatar */}
          <button
            type="button"
            onClick={onSelect}
            className="relative flex-shrink-0"
            title="Выбрать агента"
          >
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center text-base',
                isActive ? 'bg-[var(--color-primary-500)]/20' : 'bg-purple-500/20 text-purple-400'
              )}
            >
              {agent.icon ? <span className="text-base">{agent.icon}</span> : <Bot className="w-5 h-5" />}
            </div>
            <span
              className={cn(
                'absolute bottom-0 right-0 w-2 h-2 rounded-full border border-[var(--bg-secondary)]',
                agent.is_active ? 'bg-green-400' : 'bg-gray-400'
              )}
            />
          </button>

          {/* Content: 2 rows */}
          <div className="flex-1 min-w-0">
            {/* Row 1: name + (id) + active badge */}
            <button
              type="button"
              onClick={onSelect}
              className="w-full flex items-center gap-1.5 text-left"
            >
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{agent.name}</span>
              <span className="text-[10px] font-normal text-[var(--text-tertiary)] flex-shrink-0">(#{agent.id})</span>
              {isActive && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-primary-500)]/30 text-[var(--color-primary-400)] flex-shrink-0">активен</span>
              )}
            </button>

            {/* Row 2: type pill + description + toolbar */}
            <div className="mt-0.5 flex items-center gap-1 min-w-0">
              <span className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 bg-purple-500/20 text-purple-400">
                Агент
              </span>
              {agent.description ? (
                <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-1 min-w-0">
                  {agent.description}
                </span>
              ) : (
                <span className="flex-1" />
              )}

              <div className="flex items-center gap-px flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                <RowToolbarBtn
                  icon={<Star className={cn('w-3 h-3', isFavorite && 'fill-current')} />}
                  title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
                  onClick={onToggleFavorite}
                  active={isFavorite}
                  activeClass="text-yellow-400"
                />
                <RowToolbarBtn
                  icon={<Eye className="w-3 h-3" />}
                  title="Просмотр"
                  onClick={onView}
                />
                <RowToolbarBtn
                  icon={
                    <ChevronDown
                      className={cn('w-3 h-3 transition-transform', isExpanded && 'rotate-180')}
                    />
                  }
                  title={isExpanded ? 'Скрыть настройки контекста' : 'Настройки контекста'}
                  onClick={onToggleExpand}
                  active={isExpanded}
                  activeClass="text-[var(--color-primary-400)]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 bg-[var(--bg-tertiary)]/40 border-t border-[var(--border-secondary)]">
          <ContextSettingsSection
            contextSettings={savedSettings}
            onChange={() => { /* no-op: row commits on Save */ }}
            onSave={handleSaveContextSettings}
            isSaving={isSaving}
            disabled={!isAdminOrOwner}
          />
        </div>
      )}
    </div>
  );
}

function RowToolbarBtn({
  icon, title, onClick, active, activeClass,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
        active && activeClass
          ? activeClass
          : 'text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] hover:bg-[var(--bg-secondary)]'
      )}
    >
      {icon}
    </button>
  );
}
