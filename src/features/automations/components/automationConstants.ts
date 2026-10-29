import React from 'react';
import {
  Plus,
  Trash2,
  Zap,
  Clock,
  RefreshCcw,
  Webhook,
  Bell,
  Database,
  MousePointerClick,
  Sparkles,
  Calculator,
} from 'lucide-react';
import type { TriggerType, ActionType } from '../types/automation.types';

// Локализация триггеров
export const TRIGGER_LABELS: Record<TriggerType, { ru: string; en: string }> = {
  row_create: { ru: 'Создание записи', en: 'Row created' },
  row_update: { ru: 'Изменение записи', en: 'Row updated' },
  row_delete: { ru: 'Удаление записи', en: 'Row deleted' },
  button_click: { ru: 'Нажатие кнопки', en: 'Button click' },
  schedule: { ru: 'По расписанию', en: 'Scheduled' },
};

export const TRIGGER_ICONS: Record<TriggerType, React.ElementType> = {
  row_create: Plus,
  row_update: RefreshCcw,
  row_delete: Trash2,
  button_click: MousePointerClick,
  schedule: Clock,
};

// Локализация действий
export const ACTION_LABELS: Record<ActionType, { ru: string; en: string }> = {
  webhook: { ru: 'Вызов Webhook', en: 'Call Webhook' },
  update_field: { ru: 'Обновить поле', en: 'Update field' },
  create_row: { ru: 'Создать запись', en: 'Create row' },
  delete_row: { ru: 'Удалить запись', en: 'Delete row' },
  notification: { ru: 'Уведомление', en: 'Notification' },
  n8n: { ru: 'n8n Workflow', en: 'n8n Workflow' },
  api_sync: { ru: 'Синхронизация с API', en: 'API Sync' },
  ai_enrich: { ru: 'AI обогащение', en: 'AI Enrich' },
  formula: { ru: 'Формула', en: 'Formula' },
};

export const ACTION_ICONS: Record<ActionType, React.ElementType> = {
  webhook: Webhook,
  update_field: Database,
  create_row: Plus,
  delete_row: Trash2,
  notification: Bell,
  n8n: Zap,
  api_sync: RefreshCcw,
  ai_enrich: Sparkles,
  formula: Calculator,
};
