// Типы триггеров.
// Движок (backend/services/AutomationTriggerService.js) исполняет row_create, row_update и schedule.
// `column_change` удалён (чат 3660, 2026-10-20): он эквивалентен row_update + watch_field.
export type TriggerType =
  | 'row_create'       // При создании строки
  | 'row_update'       // При изменении строки (движок: AutomationTriggerService.fireRowUpdateTriggers)
  | 'row_delete'       // При удалении строки
  | 'button_click'     // При нажатии кнопки
  | 'schedule';        // По расписанию

// Типы действий
export type ActionType =
  | 'webhook'          // Вызов webhook
  | 'update_field'     // Обновить поле
  | 'create_row'       // Создать строку
  | 'delete_row'       // Удалить строку
  | 'notification'     // Отправить уведомление
  | 'n8n'              // Запустить n8n workflow
  | 'api_sync'         // Синхронизация с API
  | 'ai_enrich'        // AI обогащение через Claude (Ticket #43305)
  | 'formula';         // Вычислить формулу и записать в поле

// Операторы условий
export type ConditionOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty'
  | 'changed_to'
  | 'changed_from';

// Конфигурация триггера
export interface TriggerConfig {
  // Для row_update — ключ колонки (column_name), изменение которой запускает автоматизацию,
  // и опциональное значение, при котором срабатывать
  watch_field?: string;
  equals?: unknown;

  // Для button_click
  buttonColumnId?: string;
  
  // Для schedule
  cron?: string;
  timezone?: string;
}

// Конфигурация действия
export interface ActionConfig {
  // Для webhook
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string; // JSON template with {{field}} placeholders
  
  // Для update_field
  targetColumnId?: string;
  targetValue?: string | number | boolean;
  useFormula?: boolean;
  formula?: string;
  
  // Для create_row
  targetTableId?: string;
  fieldMappings?: Array<{
    sourceColumnId?: string;
    targetColumnId: string;
    staticValue?: unknown;
  }>;
  
  // Для notification
  notificationType?: 'email' | 'telegram' | 'slack' | 'in_app';
  recipients?: string[];
  subject?: string;
  messageTemplate?: string;
  
  // Для n8n
  workflowId?: string;
  webhookUrl?: string;
}

// Условие
export interface AutomationCondition {
  columnId: string;
  operator: ConditionOperator;
  value?: unknown;
}

// Основная модель автоматизации
export interface AutomationModel {
  id: string;
  name: string;
  description?: string;
  tableId: string;
  tableName?: string;
  isActive: boolean;
  
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  
  actionType: ActionType;
  actionConfig: ActionConfig;
  
  conditions?: AutomationCondition[];
  
  createdAt: string;
  updatedAt: string;
}

// Лог выполнения
export interface AutomationLog {
  id: string;
  automationId: string;
  rowId?: string;
  status: 'success' | 'error' | 'skipped';
  triggerData?: Record<string, unknown>;
  resultData?: Record<string, unknown>;
  errorMessage?: string;
  executedAt: string;
  durationMs?: number;
}

// Конфигурация кнопки (для колонки типа button)
export interface ButtonConfig {
  label: string;
  color?: string;
  icon?: string;
  confirmText?: string;  // Текст подтверждения перед выполнением
  automationId?: string; // Привязанная автоматизация
}
