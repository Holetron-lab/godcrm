/**
 * SubAgentSelector — Database-driven AI Agent selection
 *
 * Displays real AI Agents from the database as toggleable items.
 * Parent component fetches available agents and passes them via props.
 * Selected agents are tracked by numeric row_id.
 */

import { Check, Bot, Loader2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/** A single available agent from the database */
export interface AvailableAgent {
  row_id: number;
  name: string;
  icon?: string | null;
  description?: string;
}

export interface SubAgentSelectorProps {
  /** Currently selected sub-agent row_ids */
  value: number[];
  /** Callback when selection changes */
  onChange: (rowIds: number[]) => void;
  /** Available agents to pick from (fetched by parent) */
  availableAgents: AvailableAgent[];
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Whether agents are loading */
  isLoading?: boolean;
}

export function SubAgentSelector({
  value,
  onChange,
  availableAgents,
  disabled = false,
  isLoading = false,
}: SubAgentSelectorProps) {
  const { t } = useLanguage();

  const toggleAgent = (rowId: number) => {
    if (disabled) return;
    const isSelected = value.includes(rowId);
    if (isSelected) {
      onChange(value.filter(id => id !== rowId));
    } else {
      onChange([...value, rowId]);
    }
  };

  return (
    <div className="space-y-2" data-testid="sub-agent-selector">
      {/* Header */}
      <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
        <Bot className="w-3.5 h-3.5" />
        <span>{t('chat.subAgents') || 'Sub-agents'}</span>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-4" data-testid="sub-agent-loading">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && availableAgents.length === 0 && (
        <div
          className="text-xs text-[var(--text-tertiary)] text-center py-3"
          data-testid="sub-agent-empty"
        >
          {t('chat.noAgentsAvailable') || 'No agents available'}
        </div>
      )}

      {/* Agent list */}
      {!isLoading && availableAgents.length > 0 && (
        <div className="space-y-1">
          {availableAgents.map(agent => {
            const isSelected = value.includes(agent.row_id);
            return (
              <button
                key={agent.row_id}
                onClick={() => toggleAgent(agent.row_id)}
                disabled={disabled}
                data-testid={`sub-agent-item-${agent.row_id}`}
                className={cn(
                  'w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left',
                  isSelected
                    ? 'bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]/30'
                    : 'bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border-secondary)]',
                  disabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-base',
                    isSelected
                      ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)]'
                  )}
                >
                  {agent.icon || <Bot className="w-4 h-4" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {agent.name}
                  </div>
                  {agent.description && (
                    <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                      {agent.description}
                    </div>
                  )}
                </div>

                {/* Checkbox */}
                <div
                  className={cn(
                    'w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors',
                    isSelected
                      ? 'bg-[var(--color-primary-500)] text-white'
                      : 'bg-[var(--bg-secondary)] border border-[var(--border-primary)]'
                  )}
                >
                  {isSelected && <Check className="w-3.5 h-3.5" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SubAgentSelector;
