import { Bot, Loader2, Plus } from 'lucide-react';

interface AgentWidgetSetupProps {
  error: string | null;
  isCreatingTables: boolean;
  spaceId: number | undefined;
  handleCreateTables: () => void;
}

export function AgentWidgetSetup({ error, isCreatingTables, spaceId, handleCreateTables }: AgentWidgetSetupProps) {
  return (
        <div className="flex flex-col items-center text-center p-8 space-y-6 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">AI Агенты не настроены</h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              Для работы с AI агентами нужно создать системные таблицы в проекте &quot;System Data&quot;.
              После создания вы сможете настроить API ключи для провайдеров.
            </p>
          </div>
          {error && (
            <div className="w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-500">{error}</div>
          )}
          <button
            onClick={handleCreateTables}
            disabled={isCreatingTables || !spaceId}
            className="flex items-center gap-2 px-6 py-3 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isCreatingTables ? (
              <><Loader2 className="w-5 h-5 animate-spin" /><span>Создание таблиц...</span></>
            ) : (
              <><Plus className="w-5 h-5" /><span>Создать таблицы в System Data</span></>
            )}
          </button>
          {!spaceId && (
            <p className="text-xs text-[var(--text-tertiary)]">Выберите пространство для создания таблиц</p>
          )}
        </div>
  );
}
