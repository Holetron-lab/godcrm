/**
 * AgentEditModal
 * Modal for editing AI agent settings
 * ADR-024: AI Chat improvements
 */

import { logger } from '@/shared/utils/logger';
import { useState, useEffect } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent } from '../types';

interface AgentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AIAgent | null; // Pass agent data directly
  onSave?: () => void;
}

interface AgentFormData {
  name: string;
  description: string;
  icon: string;
  system_prompt: string;
  is_active: boolean;
}

export function AgentEditModal({ isOpen, onClose, agent, onSave }: AgentEditModalProps) {
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    description: '',
    icon: '🤖',
    system_prompt: '',
    is_active: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form data from agent prop
  useEffect(() => {
    if (isOpen && agent) {
      setFormData({
        name: agent.name || '',
        description: agent.description || '',
        icon: agent.icon || '🤖',
        system_prompt: agent.system_prompt || '',
        is_active: agent.is_active ?? true,
      });
      setError(null);
    }
  }, [isOpen, agent]);

  const handleSave = async () => {
    if (!agent) return;
    
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.put(`/ai/agents/${agent.id}`, formData);
      onSave?.();
      onClose();
    } catch (err) {
      setError('Ошибка сохранения');
      logger.error('Failed to save agent:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof AgentFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!agent) return null;

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
