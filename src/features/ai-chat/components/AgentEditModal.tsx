/**
 * AgentEditModal
 * Modal for editing AI agent settings
 * ADR-024: AI Chat improvements
 * ADR-0057: invocation-mode picker + quick commands (main_instructions JSON array)
 */

import { logger } from '@/shared/utils/logger';
import { useState, useEffect } from 'react';
import { Modal, Input } from '@/shared/components/ui';
import { Plus, Trash2, Zap } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent, QuickCommandItem } from '../types';

interface AgentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AIAgent | null; // Pass agent data directly
  onSave?: () => void;
}

type InvocationMode = 'mention' | 'command' | 'both';

interface AgentFormData {
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  is_active: boolean;
  invocation_mode: InvocationMode;
  quick_commands: QuickCommandItem[];
}

// Backend keeps `main_instructions` as either a string or an array of strings/objects.
// Normalize on the way in, serialize as an array of {label?, content} on the way out.
function normalizeQuickCommands(input: AIAgent['main_instructions']): QuickCommandItem[] {
  if (!input) return [];
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item): QuickCommandItem | null => {
      if (typeof item === 'string') return { content: item };
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const content = (obj.content ?? obj.text ?? obj.instruction) as string | undefined;
        if (typeof content !== 'string') return null;
        const label = typeof obj.label === 'string' ? obj.label : undefined;
        return label ? { label, content } : { content };
      }
      return null;
    })
    .filter((x): x is QuickCommandItem => x !== null);
}

export function AgentEditModal({ isOpen, onClose, agent, onSave }: AgentEditModalProps) {
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    description: '',
    icon: '⚡',
    system_prompt: '',
    is_active: true,
    invocation_mode: 'both',
    quick_commands: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form data from agent prop
  useEffect(() => {
    if (isOpen && agent) {
      setFormData({
        name: agent.name || '',
        description: agent.description || '',
        icon: agent.icon || '⚡',
        system_prompt: agent.system_prompt || '',
        is_active: agent.is_active ?? true,
        invocation_mode: (agent.invocation_mode as InvocationMode) || 'both',
        quick_commands: normalizeQuickCommands(agent.main_instructions),
      });
      setError(null);
    }
  }, [isOpen, agent]);

  const handleSave = async () => {
    if (!agent) return;

    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        icon: formData.icon,
        system_prompt: formData.system_prompt,
        is_active: formData.is_active,
        invocation_mode: formData.invocation_mode,
        // Persist as JSON array string — backend dispatcher already handles both
        // string-JSON and parsed-array shapes via _resolveCommandContent.
        main_instructions: formData.quick_commands.length
          ? JSON.stringify(formData.quick_commands)
          : null,
      };
      await apiClient.put(`/ai/agents/${agent.id}`, payload);
      onSave?.();
      onClose();
    } catch (err) {
      setError('Ошибка сохранения');
      logger.error('Failed to save agent:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = <K extends keyof AgentFormData>(field: K, value: AgentFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addQuickCommand = () => {
    setFormData(prev => ({
      ...prev,
      quick_commands: [...prev.quick_commands, { label: '', content: '' }],
    }));
  };

  const updateQuickCommand = (index: number, patch: Partial<QuickCommandItem>) => {
    setFormData(prev => ({
      ...prev,
      quick_commands: prev.quick_commands.map((cmd, i) => (i === index ? { ...cmd, ...patch } : cmd)),
    }));
  };

  const removeQuickCommand = (index: number) => {
    setFormData(prev => ({
      ...prev,
      quick_commands: prev.quick_commands.filter((_, i) => i !== index),
    }));
  };

  if (!agent) return null;

  const invocationOptions: Array<{ value: InvocationMode; label: string; hint: string }> = [
    { value: 'mention', label: '@mention', hint: '«@slug» — присоединяется к чату' },
    { value: 'command', label: '/command', hint: '«/slug» — одноразовый, без участника' },
    { value: 'both', label: 'Оба', hint: 'Реагирует на обе формы' },
  ];

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="Редактирование агента"
      size="md"
      primaryAction={{
        label: isSaving ? 'Сохранение...' : 'Сохранить',
        onClick: handleSave,
        variant: 'primary',
      }}
      secondaryAction={{
        label: 'Отмена',
        onClick: onClose,
        variant: 'ghost',
      }}
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Icon + Name row */}
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Иконка
            </label>
            <input
              type="text"
              value={formData.icon}
              onChange={(e) => handleChange('icon', e.target.value)}
              className="w-14 h-10 text-center text-2xl rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
              maxLength={4}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Имя агента
            </label>
            <Input
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Например: Помощник"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Описание
          </label>
          <Input
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Краткое описание агента"
          />
        </div>

        {/* System prompt */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Системный промпт
          </label>
          <textarea
            value={formData.system_prompt}
            onChange={(e) => handleChange('system_prompt', e.target.value)}
            placeholder="Инструкции для агента..."
            rows={6}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 resize-none text-sm"
          />
        </div>

        {/* Invocation mode (ADR-0057) */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Способ вызова
          </label>
          <div className="grid grid-cols-3 gap-2">
            {invocationOptions.map(opt => {
              const isActive = formData.invocation_mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChange('invocation_mode', opt.value)}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                    isActive
                      ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--text-primary)]'
                      : 'border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                  title={opt.hint}
                >
                  <div className="font-mono font-semibold text-[var(--text-primary)]">{opt.label}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-tight">{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick commands (ADR-0057, main_instructions JSON array) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Быстрые команды
              <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)] font-normal">
                <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]">{`<</${agent.name?.toLowerCase().replace(/\s+/g, '-') || 'slug'}/N>>`}</code>
              </span>
            </label>
            <button
              type="button"
              onClick={addQuickCommand}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Plus className="w-3 h-3" />
              Добавить
            </button>
          </div>

          {formData.quick_commands.length === 0 ? (
            <div className="px-3 py-3 rounded-lg border border-dashed border-[var(--border-secondary)] text-xs text-[var(--text-tertiary)] text-center">
              Нет быстрых команд. Добавь — и они будут доступны по <code>{`<</slug/0>>`}</code>, <code>{`<</slug/1>>`}</code>…
            </div>
          ) : (
            <div className="space-y-2">
              {formData.quick_commands.map((cmd, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]"
                >
                  <div className="flex flex-col items-center gap-1 pt-1.5 text-[var(--text-tertiary)]">
                    <span className="text-[10px] font-mono tabular-nums">{idx}</span>
                    <Zap className="w-3 h-3" />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={cmd.label || ''}
                      onChange={(e) => updateQuickCommand(idx, { label: e.target.value })}
                      placeholder="Метка (необязательно)"
                    />
                    <textarea
                      value={cmd.content}
                      onChange={(e) => updateQuickCommand(idx, { content: e.target.value })}
                      placeholder="Текст команды — будет отправлен агенту как сообщение"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 resize-none text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuickCommand(idx)}
                    className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Активен</div>
            <div className="text-xs text-[var(--text-tertiary)]">Агент доступен для выбора</div>
          </div>
          <button
            type="button"
            onClick={() => handleChange('is_active', !formData.is_active)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              formData.is_active
                ? 'bg-[var(--color-primary-500)]'
                : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                formData.is_active ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </Modal>
  );
}
