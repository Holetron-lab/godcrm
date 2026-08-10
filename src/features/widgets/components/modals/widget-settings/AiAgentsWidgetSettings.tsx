import type { AiAgentsSettingsProps } from './types';

export function AiAgentsWidgetSettings({
  tables,
  aiOperatorsTableId,
  setAiOperatorsTableId,
  aiAgentsTableId,
  setAiAgentsTableId,
  aiChatHistoryTableId,
  setAiChatHistoryTableId,
  aiRunLogsTableId,
  setAiRunLogsTableId,
  aiAnalyticsTableId,
  setAiAnalyticsTableId,
  aiFeedbackTableId,
  setAiFeedbackTableId,
}: AiAgentsSettingsProps) {
  return (
    <>
      <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 mb-4">
        <p className="text-sm text-[var(--text-secondary)]">
          AI Agents использует 6 таблиц для хранения операторов, агентов, истории чата, логов и аналитики.
          Таблицы создаются в проекте &quot;System Data&quot;.
        </p>
      </div>

      {/* AI Operators Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица операторов (API ключи)
        </label>
        <select
          value={aiOperatorsTableId}
          onChange={(e) => setAiOperatorsTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          OpenAI, Anthropic, Google AI и другие провайдеры
        </p>
      </div>

      {/* AI Agents Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица агентов
        </label>
        <select
          value={aiAgentsTableId}
          onChange={(e) => setAiAgentsTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Конфигурация агентов с промптами и настройками
        </p>
      </div>

      {/* AI Chat History Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица истории чата
        </label>
        <select
          value={aiChatHistoryTableId}
          onChange={(e) => setAiChatHistoryTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>

      {/* AI Run Logs Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица логов запусков
        </label>
        <select
          value={aiRunLogsTableId}
          onChange={(e) => setAiRunLogsTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>

      {/* AI Analytics Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица аналитики
        </label>
        <select
          value={aiAnalyticsTableId}
          onChange={(e) => setAiAnalyticsTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>

      {/* AI Feedback Table */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Таблица обратной связи
        </label>
        <select
          value={aiFeedbackTableId}
          onChange={(e) => setAiFeedbackTableId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите таблицу</option>
          {tables.map((table) => (
            <option key={String(table.id)} value={String(table.id)}>
              {table.icon} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
