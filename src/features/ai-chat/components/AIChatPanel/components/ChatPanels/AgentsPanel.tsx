/**
 * AgentsPanel Component
 * Extracted from AIChatPanel.tsx - lines 1491-1720
 */

import { Search, X, Star, Loader2, Brain, Bot, Plus, MessageSquare } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { AIAgent, PanelTab, AIOperator, AIModel } from '../../types';

interface AgentsPanelProps {
  agentsSearch: string;
  setAgentsSearch: (search: string) => void;
  showFavoriteAgents: boolean;
  setShowFavoriteAgents: (show: boolean) => void;
  isVectorSearching: boolean;
  vectorSearchResults: number[] | null;
  setVectorSearchResults: (results: number[] | null) => void;
  agents: AIAgent[];
  currentAgent: AIAgent | null;
  favoriteAgents: number[];
  setFavoriteAgents: (agents: number[] | ((prev: number[]) => number[])) => void;
  onVectorSearch: () => void;
  onAgentSelect: (agent: AIAgent) => void;
  onClearMessages: () => void;
  onCreateTables: () => void;
  setActivePanel: (panel: PanelTab) => void;
  isCreatingTables: boolean;
  isLoadingAgents?: boolean;
  createTablesError: string | null;
  isAdminOrOwner: boolean;
  operators: AIOperator[];
  models: AIModel[];
  currentOperatorId?: number;
  onOperatorChange: (operatorId: number) => void;
}

export function AgentsPanel({
  agentsSearch,
  setAgentsSearch,
  showFavoriteAgents,
  setShowFavoriteAgents,
  isVectorSearching,
  vectorSearchResults,
  setVectorSearchResults,
  agents,
  currentAgent,
  favoriteAgents,
  setFavoriteAgents,
  onVectorSearch,
  onAgentSelect,
  onClearMessages,
  onCreateTables,
  setActivePanel,
  isCreatingTables,
  isLoadingAgents = false,
  createTablesError,
  isAdminOrOwner,
  operators,
  models,
  currentOperatorId,
  onOperatorChange
}: AgentsPanelProps) {
  // Filter agents based on search and favorites
  const filteredAgents = agents.filter(agent => {
    // Search filter
    if (agentsSearch) {
      const searchLower = agentsSearch.toLowerCase();
      const matchesName = agent.name.toLowerCase().includes(searchLower);
      const matchesDescription = agent.description?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesDescription) return false;
    }
    
    // Favorites filter
    if (showFavoriteAgents && !favoriteAgents.includes(agent.id)) return false;
    
    return true;
  });

  const handleSearchChange = (value: string) => {
    setAgentsSearch(value);
    if (!value) setVectorSearchResults(null);
  };

  const handleClearSearch = () => {
    setAgentsSearch('');
    setVectorSearchResults(null);
  };

  const handleAgentSelect = (agent: AIAgent) => {
    onAgentSelect(agent);
  };

  const handleNewChat = (agent: AIAgent) => {
    handleAgentSelect(agent);
    onClearMessages();
    setActivePanel('none');
  };

  const handleToggleFavorite = (agentId: number) => {
    setFavoriteAgents(prev => 
      prev.includes(agentId) 
        ? prev.filter(id => id !== agentId) 
        : [...prev, agentId]
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: Search + Favorites + AI search */}
      <div className="px-2 py-1.5 border-b border-[var(--border-secondary)] flex items-center gap-1.5">
        {/* Search input */}
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={agentsSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Поиск агентов..."
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/50"
          />
          {agentsSearch && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Favorites toggle */}
        <button
          onClick={() => setShowFavoriteAgents(!showFavoriteAgents)}
          className={cn(
            "p-1.5 rounded-lg border transition-colors",
            showFavoriteAgents
              ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/30"
              : "text-[var(--text-tertiary)] border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          )}
          title={showFavoriteAgents ? "Показать всех" : "Только избранные"}
        >
          <Star className={cn("w-3.5 h-3.5", showFavoriteAgents && "fill-current")} />
        </button>
        {/* AI search button */}
        <button
          onClick={onVectorSearch}
          disabled={isVectorSearching || !agentsSearch}
          className={cn(
            "p-1.5 rounded-lg border transition-colors",
            vectorSearchResults 
              ? "bg-green-500/20 text-green-400 border-green-500/30" 
              : "text-[var(--text-tertiary)] border-[var(--border-secondary)] hover:bg-purple-500/10 hover:text-purple-400 hover:border-purple-500/30",
            (!agentsSearch || isVectorSearching) && "opacity-50 cursor-not-allowed"
          )}
          title={vectorSearchResults ? "AI поиск активен" : "Семантический поиск"}
        >
          {isVectorSearching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" />
          ) : (
            <Brain className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filteredAgents.length === 0 ? (
          agentsSearch ? (
            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              Не найдено
            </div>
          ) : isLoadingAgents ? (
            /* Ticket #81428: Show spinner while agents are loading */
            <div className="py-8 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary-500)]" />
              <span className="text-sm text-[var(--text-tertiary)]">Загрузка агентов...</span>
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500/20 to-primary-500/20 flex items-center justify-center mb-4 mx-auto">
                <Bot className="w-7 h-7 text-[var(--color-primary-500)]" />
              </div>
              <h3 className="font-medium text-[var(--text-primary)] mb-2">
                AI агенты не настроены
              </h3>
              <p className="text-sm text-[var(--text-tertiary)] mb-4">
                Создайте AI таблицы в System Data для работы с агентами
              </p>
              <button
                onClick={() => {
                  logger.debug('[Chat v2] Create tables clicked');
                  onCreateTables();
                }}
                disabled={isCreatingTables}
                className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium mx-auto"
              >
                {isCreatingTables ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Создание...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Создать AI таблицы
                  </>
                )}
              </button>
              {createTablesError && (
                <p className="text-sm text-red-500 mt-2">Ошибка создания таблиц</p>
              )}
            </div>
          )
        ) : (
          filteredAgents.map(agent => {
            const isFavorite = favoriteAgents.includes(agent.id);

            return (
              <div key={agent.id} className="border-b border-[var(--border-secondary)] last:border-b-0">
                {/* Agent row */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 transition-colors group",
                    currentAgent?.id === agent.id
                      ? "bg-[var(--color-primary-500)]/10"
                      : "hover:bg-[var(--bg-tertiary)]"
                  )}
                >
                  {/* Favorite button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(agent.id);
                    }}
                    className={cn(
                      "p-1 rounded border transition-colors",
                      isFavorite 
                        ? "text-yellow-500 border-yellow-500/30 bg-yellow-500/10" 
                        : "text-[var(--text-tertiary)] border-[var(--border-secondary)] hover:text-yellow-500 hover:border-yellow-500/30"
                    )}
                    title={isFavorite ? "Убрать из избранного" : "В избранное"}
                  >
                    <Star className={cn("w-3.5 h-3.5", isFavorite && "fill-current")} />
                  </button>
                  
                  {/* Clickable area for selecting agent */}
                  <button
                    onClick={() => handleAgentSelect(agent)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {/* Avatar */}
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0",
                      currentAgent?.id === agent.id
                        ? "bg-[var(--color-primary-500)]/20"
                        : "bg-[var(--bg-tertiary)]"
                    )}>
                      {agent.icon || '🤖'}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{agent.name}</span>
                        {currentAgent?.id === agent.id && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-primary-500)]/30 text-[var(--color-primary-400)] flex-shrink-0">
                            активен
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">{agent.description}</p>
                      )}
                    </div>
                  </button>
                  
                  {/* Action buttons - always visible with border */}
                  <div className="flex items-center gap-1">
                    {/* New chat */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewChat(agent);
                      }}
                      className="p-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] hover:border-[var(--color-primary-500)]/30 hover:bg-[var(--color-primary-500)]/10 transition-colors"
                      title="Новый чат"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}