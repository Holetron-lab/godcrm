import {
  Bot,
  Check,
  Key,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { AIOperator } from './types';

export interface ApiKeyDialogProps {
  operators: AIOperator[];
  setupOperatorId: number | null;
  onSetupOperatorId: (id: number | null) => void;
  apiKeyInput: string;
  onApiKeyInputChange: (value: string) => void;
  isSavingApiKey: boolean;
  onSave: () => void;
  onClose: () => void;
}

export function ApiKeyDialog({
  operators,
  setupOperatorId,
  onSetupOperatorId,
  apiKeyInput,
  onApiKeyInputChange,
  isSavingApiKey,
  onSave,
  onClose,
}: ApiKeyDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--bg-secondary)] rounded-xl shadow-2xl border border-[var(--border-primary)] w-[420px] max-w-[90vw] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--text-primary)]">Настройка API ключа</h3>
              <p className="text-xs text-[var(--text-tertiary)]">Выберите провайдера и введите ключ</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Operator Selection */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Провайдер AI
            </label>
            <div className="grid grid-cols-2 gap-2">
              {operators.map((operator) => (
                <button
                  key={operator.id}
                  onClick={() => onSetupOperatorId(operator.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-left",
                    setupOperatorId === operator.id
                      ? "border-[var(--color-primary-500)] bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"
                      : "border-[var(--border-primary)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
                  )}
                >
                  <Bot className="w-4 h-4 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{operator.name}</div>
                    {operator.api_key && (
                      <div className="flex items-center gap-1 text-xs text-green-500">
                        <Check className="w-3 h-3" />
                        <span>Ключ есть</span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          {setupOperatorId && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                API ключ для {operators.find(o => o.id === setupOperatorId)?.name}
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => onApiKeyInputChange(e.target.value)}
                placeholder="sk-..."
                className="w-full px-4 py-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] font-mono text-sm"
                autoFocus
              />
              <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                Ключ будет сохранён и использован для запросов к API
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={onSave}
            disabled={!setupOperatorId || !apiKeyInput.trim() || isSavingApiKey}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isSavingApiKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Сохранение...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Сохранить</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
