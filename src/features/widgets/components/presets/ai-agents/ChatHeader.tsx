import {
  Bot,
  ChevronDown,
  Plus,
  History,
  Cpu,
  AlertCircle,
  Settings
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { AIAgent, AIModel, AIOperator } from './types';

export interface ChatHeaderProps {
  currentAgent: AIAgent | null;
  agents: AIAgent[];
  showAgentSelector: boolean;
  onToggleAgentSelector: () => void;
  onSelectAgent: (agent: AIAgent) => void;
  // Operator
  operators: AIOperator[];
  selectedOperatorId: number | null;
  selectedOperator: AIOperator | undefined;
  showOperatorSelector: boolean;
  onToggleOperatorSelector: () => void;
  onSelectOperator: (id: number) => void;
  isOperatorMismatch: boolean;
  agentOperatorId: number | undefined;
  // Model
  providerModels: AIModel[];
  selectedModelApiId: string | null;
  selectedModel: AIModel | undefined;
  showModelSelector: boolean;
  onToggleModelSelector: () => void;
  onSelectModel: (modelId: string) => void;
  getModelDisplayName: () => string;
  // Actions
  showSettings: boolean;
  onToggleSettings: () => void;
  onNewConversation: () => void;
  // History button
  sidebarCollapsed: boolean;
  widgetWidth: number;
  showConversations: boolean;
  onToggleConversations: () => void;
  onExpandSidebar: () => void;
}

export function ChatHeader({
  currentAgent,
  agents,
  showAgentSelector,
  onToggleAgentSelector,
  onSelectAgent,
  operators,
  selectedOperatorId,
  selectedOperator,
  showOperatorSelector,
  onToggleOperatorSelector,
  onSelectOperator,
  isOperatorMismatch,
  agentOperatorId,
  providerModels,
  selectedModelApiId,
  selectedModel,
  showModelSelector,
  onToggleModelSelector,
  onSelectModel,
  getModelDisplayName,
  showSettings,
  onToggleSettings,
  onNewConversation,
  sidebarCollapsed,
  widgetWidth,
  showConversations,
  onToggleConversations,
  onExpandSidebar,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-base flex-shrink-0">
          {currentAgent?.icon || '🤖'}
        </div>
        <div className="relative">
          <button
            onClick={onToggleAgentSelector}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
          >
            <span className="font-medium text-[var(--text-primary)] max-w-[140px] truncate">
              {currentAgent?.name || 'Select Agent'}
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform', showAgentSelector && 'rotate-180')} />
          </button>

          {showAgentSelector && (
            <div className="absolute top-full left-0 mt-1 z-50 w-[220px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {agents.length === 0 ? (
                <div className="px-3 py-3 text-center text-sm text-[var(--text-tertiary)]">Нет агентов</div>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => onSelectAgent(agent)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors',
                      currentAgent?.id === agent.id && 'bg-[var(--color-primary-50)]'
                    )}
                  >
                    <span className="text-lg">{agent.icon || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-[var(--text-primary)] truncate">{agent.name}</div>
                      <div className="text-xs text-[var(--text-tertiary)] truncate">{agent.description || agent.model_name}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {/* Operator Selector */}
        <div className="relative">
          <button
            onClick={onToggleOperatorSelector}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs",
              isOperatorMismatch
                ? "text-orange-500 bg-orange-500/10 hover:bg-orange-500/20"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
            title={isOperatorMismatch
              ? `Оператор не совпадает с оператором агента (${operators.find(o => o.id === Number(agentOperatorId))?.name || 'неизвестный'})`
              : undefined
            }
          >
            {isOperatorMismatch && <AlertCircle className="w-3 h-3" />}
            <Bot className="w-3.5 h-3.5" />
            <span className="max-w-[70px] truncate">
              {selectedOperator?.name || 'Оператор'}
            </span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', showOperatorSelector && 'rotate-180')} />
          </button>

          {showOperatorSelector && (
            <div className="absolute top-full right-0 mt-1 z-50 w-[200px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {operators.length === 0 ? (
                <div className="px-3 py-3 text-center text-sm text-[var(--text-tertiary)]">Нет операторов</div>
              ) : (
                operators.map((operator) => (
                  <button
                    key={operator.id}
                    onClick={() => onSelectOperator(operator.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors text-sm',
                      selectedOperatorId === operator.id && 'bg-[var(--color-primary-50)]'
                    )}
                  >
                    <span className="text-[var(--text-primary)] truncate">{operator.name}</span>
                    {selectedOperatorId === operator.id && (
                      <span className="ml-auto text-[var(--color-primary-500)]">✓</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {/* Model Selector */}
        <div className="relative">
          <button
            onClick={onToggleModelSelector}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-xs"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="max-w-[140px] truncate">
              {getModelDisplayName()}
            </span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', showModelSelector && 'rotate-180')} />
          </button>

          {showModelSelector && (
            <div className="absolute top-full right-0 mt-1 z-50 w-[280px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {providerModels.length === 0 ? (
                <div className="px-3 py-3 text-center text-sm text-[var(--text-tertiary)]">
                  {selectedOperatorId ? 'Нет моделей у оператора' : 'Выберите оператора'}
                </div>
              ) : (
                providerModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => onSelectModel(model.model_id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors text-sm',
                      (selectedModelApiId === model.model_id || selectedModel?.id === model.id) && 'bg-[var(--color-primary-50)]'
                    )}
                  >
                    <span className="text-[var(--text-primary)] truncate">{model.name}</span>
                    {(selectedModelApiId === model.model_id || selectedModel?.id === model.id) && (
                      <span className="ml-auto text-[var(--color-primary-500)]">✓</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Settings Button */}
        <button
          onClick={onToggleSettings}
          className={cn(
            "p-1.5 rounded-md transition-colors",
            showSettings
              ? "text-[var(--color-primary-500)] bg-[var(--bg-tertiary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          )}
          title="Настройки"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onNewConversation}
          className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Новый чат"
        >
          <Plus className="w-4 h-4" />
        </button>
        {/* Show history button when sidebar is collapsed or on mobile */}
        {(sidebarCollapsed || widgetWidth <= 800) && (
          <button
            onClick={() => {
              if (widgetWidth <= 800) {
                onToggleConversations();
              } else {
                onExpandSidebar();
              }
            }}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              showConversations
                ? "text-[var(--color-primary-500)] bg-[var(--bg-tertiary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
            title="История чатов"
          >
            <History className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
