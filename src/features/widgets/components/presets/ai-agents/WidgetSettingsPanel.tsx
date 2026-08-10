import { useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import type { AIOperator, AIModel } from './types';

export interface WidgetSettingsPanelProps {
  operators: AIOperator[];
  selectedOperatorId: number | null;
  onOperatorChange: (id: number | null) => void;
  providerModels: AIModel[];
  selectedModelApiId: string | null;
  setSelectedModelApiId: (id: string) => void;
  isLoadingModels: boolean;
  onClose: () => void;
}

export function WidgetSettingsPanel({
  operators,
  selectedOperatorId,
  onOperatorChange,
  providerModels,
  selectedModelApiId,
  setSelectedModelApiId,
  isLoadingModels,
  onClose
}: WidgetSettingsPanelProps) {
  const [expandedOperatorId, setExpandedOperatorId] = useState<number | null>(selectedOperatorId);
  const currentSpace = useCurrentSpace();

  // Load all models from table
  const { data: allModels = [], isLoading: isLoadingAllModels } = useQuery({
    queryKey: ['all-ai-models', currentSpace?.id],
    queryFn: async () => {
      const params = currentSpace?.id ? `?spaceId=${currentSpace.id}` : '';
      const response = await apiClient.get<{ success: boolean; data: { models: AIModel[] } }>(
        `/ai/models${params}`
      );
      return response.success && response.data?.models ? response.data.models : [];
    }
  });

  // Filter operators with API keys only
  const operatorsWithKeys = operators.filter(op => op.api_key && op.api_key.length > 10);

  // Group models by operator
  const modelsByOperator = allModels.reduce((acc, model) => {
    const opId = model.operator_id || model.provider_id;
    if (!acc[opId!]) acc[opId!] = [];
    acc[opId!].push(model);
    return acc;
  }, {} as Record<number, AIModel[]>);

  // Sort: selected first, then others
  const selectedOperator = operatorsWithKeys.find(op => op.id === selectedOperatorId);
  const otherOperators = operatorsWithKeys.filter(op => op.id !== selectedOperatorId);

  const toggleExpand = (id: number) => {
    setExpandedOperatorId(expandedOperatorId === id ? null : id);
  };

  const handleOperatorSelect = (id: number) => {
    onOperatorChange(id);
    setExpandedOperatorId(id);
  };

  return (
    <div className="border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] max-h-[350px] overflow-y-auto">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-[var(--text-primary)]">Настройки</div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoadingAllModels ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : operatorsWithKeys.length === 0 ? (
          <div className="text-sm text-[var(--text-tertiary)] text-center py-4">
            Нет операторов с API ключами
          </div>
        ) : (
          <div className="space-y-2">
            {/* Selected operator - always expanded */}
            {selectedOperator && (
              <SimpleOperatorAccordion
                operator={selectedOperator}
                models={modelsByOperator[selectedOperator.id] || []}
                isSelected={true}
                isExpanded={true}
                selectedModelApiId={selectedModelApiId}
                setSelectedModelApiId={setSelectedModelApiId}
                onSelect={handleOperatorSelect}
                onToggle={() => {}}
              />
            )}

            {/* Other operators with keys */}
            {otherOperators.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-primary)]">
                <div className="text-xs text-[var(--text-tertiary)] mb-2">Другие операторы</div>
                <div className="space-y-1">
                  {otherOperators.map((op) => (
                    <SimpleOperatorAccordion
                      key={op.id}
                      operator={op}
                      models={modelsByOperator[op.id] || []}
                      isSelected={false}
                      isExpanded={expandedOperatorId === op.id}
                      selectedModelApiId={selectedModelApiId}
                      setSelectedModelApiId={setSelectedModelApiId}
                      onSelect={handleOperatorSelect}
                      onToggle={() => toggleExpand(op.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Simple Operator Accordion - uses pre-loaded models
interface SimpleOperatorAccordionProps {
  operator: AIOperator;
  models: AIModel[];
  isSelected: boolean;
  isExpanded: boolean;
  selectedModelApiId: string | null;
  setSelectedModelApiId: (id: string) => void;
  onSelect: (id: number) => void;
  onToggle: () => void;
}

function SimpleOperatorAccordion({
  operator,
  models,
  isSelected,
  isExpanded,
  selectedModelApiId,
  setSelectedModelApiId,
  onSelect,
  onToggle
}: SimpleOperatorAccordionProps) {
  return (
    <div className={cn(
      "rounded-lg border transition-colors",
      isSelected
        ? "border-[var(--color-primary-500)] bg-[var(--color-primary-50)]"
        : "border-[var(--border-primary)] bg-[var(--bg-tertiary)]"
    )}>
      {/* Header */}
      <button
        onClick={() => {
          if (isSelected) {
            onToggle();
          } else {
            onSelect(operator.id);
          }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
        <div className="flex-1 min-w-0">
          <span className={cn(
            "font-medium",
            isSelected ? "text-[var(--color-primary-600)]" : "text-[var(--text-primary)]"
          )}>{operator.name}</span>
          <span className="text-xs text-[var(--text-tertiary)] ml-1.5">({operator.provider || operator.type})</span>
        </div>
        {isSelected && <Check className="w-4 h-4 text-[var(--color-primary-500)] flex-shrink-0" />}
        <ChevronDown className={cn(
          "w-4 h-4 text-[var(--text-tertiary)] transition-transform flex-shrink-0",
          isExpanded && "rotate-180"
        )} />
      </button>

      {/* Models list */}
      {isExpanded && (
        <div className="px-3 pb-2 border-t border-[var(--border-primary)]">
          <div className="text-xs text-[var(--text-tertiary)] mt-2 mb-1 flex items-center gap-1">
            <Bot className="w-3 h-3" />
            Модели ({models.length})
          </div>
          {models.length === 0 ? (
            <div className="text-xs text-[var(--text-tertiary)] py-1">Нет моделей</div>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {models.map((model) => (
                <button
                  key={model.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isSelected) {
                      onSelect(operator.id);
                    }
                    setSelectedModelApiId(model.model_id);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs transition-colors',
                    selectedModelApiId === model.model_id && isSelected
                      ? 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)]'
                      : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  )}
                >
                  <span className="flex-1 truncate">{model.name}</span>
                  {selectedModelApiId === model.model_id && isSelected && (
                    <Check className="w-3 h-3 text-[var(--color-primary-500)]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
