import {
  Bot, MessageSquare, Cpu, RefreshCw,
} from 'lucide-react';
import { ApiEndpoint, CodeBlock, ToolRow } from './SharedComponents';

export function AIAgentsApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Bot className="inline w-8 h-8 mr-2 text-violet-500" />
          AI Agents API
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          API для работы с AI-агентами, провайдерами и моделями. Позволяет управлять
          искусственным интеллектом в вашем рабочем пространстве.
        </p>
      </header>

      {/* Overview */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🎯 Обзор возможностей</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30">
            <Bot className="w-6 h-6 text-violet-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">AI Агенты</h4>
            <p className="text-sm text-[var(--text-secondary)]">Создание и управление интеллектуальными помощниками</p>
          </div>
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <MessageSquare className="w-6 h-6 text-primary-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Чат с агентами</h4>
            <p className="text-sm text-[var(--text-secondary)]">Отправка сообщений и получение ответов от AI</p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <Cpu className="w-6 h-6 text-emerald-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Провайдеры</h4>
            <p className="text-sm text-[var(--text-secondary)]">OpenAI, Anthropic, Google, Ollama</p>
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <RefreshCw className="w-6 h-6 text-amber-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Модели</h4>
            <p className="text-sm text-[var(--text-secondary)]">GPT-4, Claude, Gemini и другие</p>
          </div>
        </div>
      </section>

      {/* Base URL */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🌐 Базовый URL</h2>
        <CodeBlock title="Base URL" code="https://crm.hltrn.cc/api/v3/ai" />
      </section>

      {/* Agents API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🤖 Агенты</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/agents" description="Получить список всех агентов" />
          <ApiEndpoint method="GET" path="/ai/agents/:spaceId" description="Получить агентов для конкретного пространства" />
          <ApiEndpoint
            method="POST"
            path="/ai/agents"
            description="Создать нового агента"
            body={{
              name: "string",
              description: "string?",
              model: "gpt-4-turbo",
              provider: "openai",
              system_prompt: "string?",
              tools: "string[]?"
            }}
          />
          <ApiEndpoint method="PATCH" path="/ai/agents/:id" description="Обновить агента" body={{ name: "string?", model: "string?", system_prompt: "string?" }} />
          <ApiEndpoint method="DELETE" path="/ai/agents/:id" description="Удалить агента" />
        </div>
      </section>

      {/* Chat API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💬 Чат с агентом</h2>
        <div className="space-y-4">
          <ApiEndpoint
            method="POST"
            path="/ai/chat"
            description="Отправить сообщение агенту и получить ответ"
            body={{
              agentId: "number",
              message: "string",
              conversationId: "string?",
              context: "object?"
            }}
          />

          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Пример ответа</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-emerald-400 overflow-x-auto">
{`{
  "success": true,
  "response": "Привет! Я готов помочь вам с задачами...",
  "conversationId": "conv_abc123",
  "model": "gpt-4-turbo",
  "usage": {
    "promptTokens": 150,
    "completionTokens": 85,
    "totalTokens": 235
  }
}`}
            </pre>
          </div>

          <ApiEndpoint method="GET" path="/ai/conversations/:conversationId" description="Получить историю диалога" />
          <ApiEndpoint method="DELETE" path="/ai/conversations/:conversationId" description="Удалить диалог" />
        </div>
      </section>

      {/* Providers API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔌 Провайдеры AI</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/providers" description="Получить список провайдеров AI" />

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Поддерживаемые провайдеры</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">openai</code> — OpenAI (GPT-4, GPT-3.5)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">anthropic</code> — Anthropic (Claude)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">google</code> — Google (Gemini)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">ollama</code> — Ollama (локальные модели)</span>
            </div>
          </div>

          <ApiEndpoint
            method="POST"
            path="/ai/providers"
            description="Добавить провайдера"
            body={{
              name: "string",
              provider_key: "openai|anthropic|google|ollama",
              base_url: "string?",
              is_active: true
            }}
          />
          <ApiEndpoint method="PATCH" path="/ai/providers/:id" description="Обновить провайдера" />
          <ApiEndpoint method="DELETE" path="/ai/providers/:id" description="Удалить провайдера" />
        </div>
      </section>

      {/* Models API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🧠 Модели</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/models" description="Получить список всех моделей" />
          <ApiEndpoint method="GET" path="/ai/models?providerId=:id" description="Получить модели конкретного провайдера" />

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Популярные модели</h4>
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <p><strong>OpenAI:</strong> gpt-4-turbo, gpt-4o, gpt-3.5-turbo</p>
              <p><strong>Anthropic:</strong> claude-3-5-sonnet-20241022, claude-3-opus</p>
              <p><strong>Google:</strong> gemini-1.5-pro, gemini-1.5-flash</p>
              <p><strong>Ollama:</strong> llama3.2, mistral, codellama</p>
            </div>
          </div>

          <ApiEndpoint
            method="POST"
            path="/ai/models"
            description="Добавить модель"
            body={{
              provider_id: "number",
              model_id: "gpt-4-turbo",
              display_name: "GPT-4 Turbo",
              context_window: 128000,
              is_active: true
            }}
          />
          <ApiEndpoint method="PATCH" path="/ai/models/:id" description="Обновить модель" />
          <ApiEndpoint method="DELETE" path="/ai/models/:id" description="Удалить модель" />
        </div>
      </section>

      {/* Refresh Models */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔄 Обновление моделей</h2>
        <div className="space-y-4">
          <ApiEndpoint method="POST" path="/ai/providers/:providerId/refresh-models" description="Обновить список моделей от провайдера через API" />

          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Пример ответа</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-emerald-400 overflow-x-auto">
{`{
  "success": true,
  "message": "Обновлено моделей: 17",
  "added": 12,
  "updated": 5,
  "models": [
    { "model_id": "gpt-4-turbo", "display_name": "GPT-4 Turbo" },
    { "model_id": "gpt-4o", "display_name": "GPT-4o" },
    ...
  ]
}`}
            </pre>
          </div>

          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">⚠️ Важно</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Для обновления моделей требуется настроенный API ключ провайдера в таблице API Keys.
              Поддерживается автоматическое обновление для OpenAI и Anthropic.
            </p>
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔑 API Ключи для AI</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            API ключи провайдеров хранятся в таблице "API Keys" пространства "AI Agents".
          </p>

          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Структура записи API Key</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-emerald-400 overflow-x-auto">
{`{
  "provider": "openai",      // openai, anthropic, google
  "key_name": "OpenAI API",  // Название для отображения
  "api_key": "sk-...",       // Ключ API (зашифрован)
  "is_active": true,         // Активен ли ключ
  "last_used": "2024-01-15"  // Дата последнего использования
}`}
            </pre>
          </div>
        </div>
      </section>

      {/* Agent Tools */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🛠️ Инструменты агентов</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            Агенты могут использовать инструменты для взаимодействия с CRM.
          </p>

          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
            <ToolRow name="get_workspace_info" description="Получить информацию о пространствах, проектах и таблицах" />
            <ToolRow name="query_table_data" description="Выполнить запрос к данным таблицы" />
            <ToolRow name="create_table" description="Создать новую таблицу" />
            <ToolRow name="create_row" description="Добавить запись в таблицу" />
            <ToolRow name="update_row" description="Обновить запись в таблице" />
            <ToolRow name="create_dashboard" description="Создать дашборд" />
            <ToolRow name="create_widget" description="Добавить виджет на дашборд" />
            <ToolRow name="search_records" description="Поиск записей по критериям" />
          </div>
        </div>
      </section>

      {/* Examples */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💡 Примеры использования</h2>
        <div className="space-y-4">
          <CodeBlock
            title="Отправить сообщение агенту (cURL)"
            code={`curl -X POST https://crm.hltrn.cc/api/v3/ai/chat \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{
    "agentId": 1,
    "message": "Покажи статистику продаж за этот месяц",
    "context": {
      "spaceId": 5,
      "tableId": 12
    }
  }'`}
          />

          <CodeBlock
            title="JavaScript / Fetch"
            code={`const response = await fetch('/api/v3/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 1,
    message: 'Создай отчет по задачам',
    conversationId: 'conv_existing_id' // опционально
  })
});

const { response: aiResponse, usage } = await response.json();
logger.debug('AI ответил:', aiResponse);
logger.debug('Использовано токенов:', usage.totalTokens);`}
          />

          <CodeBlock
            title="Обновить модели провайдера"
            code={`// Получить свежий список моделей от OpenAI
const result = await fetch('/api/v3/ai/providers/1/refresh-models', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
});

const { added, updated, models } = await result.json();
console.log(\`Добавлено: \${added}, обновлено: \${updated}\`);`}
          />
        </div>
      </section>

      {/* Error Handling */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚠️ Обработка ошибок</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">400</span>
              <span className="text-[var(--text-secondary)] ml-2">Неверный запрос</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-yellow-500">401</span>
              <span className="text-[var(--text-secondary)] ml-2">Не авторизован</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-orange-500">404</span>
              <span className="text-[var(--text-secondary)] ml-2">Агент не найден</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">500</span>
              <span className="text-[var(--text-secondary)] ml-2">Ошибка AI провайдера</span>
            </div>
          </div>
          <CodeBlock
            title="Формат ошибки AI"
            code={`{
  "success": false,
  "error": "AI_PROVIDER_ERROR",
  "message": "OpenAI API rate limit exceeded",
  "details": {
    "provider": "openai",
    "model": "gpt-4-turbo"
  }
}`}
          />
        </div>
      </section>
    </div>
  );
}
