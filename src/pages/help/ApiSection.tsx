import { ApiEndpoint, CodeBlock } from './SharedComponents';

export function ApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          REST API
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          GOD CRM предоставляет полнофункциональный REST API для интеграции с внешними системами.
          Все эндпоинты возвращают JSON и требуют аутентификации.
        </p>
      </header>

      {/* Authentication */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔐 Аутентификация</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            API поддерживает два способа аутентификации: JWT токены и API ключи.
          </p>

          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">🔑 API Ключи (рекомендуется для интеграций)</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Создайте API ключ в Настройках → API Ключи. Ключ начинается с <code className="bg-[var(--bg-secondary)] px-1 rounded">sk-</code>
            </p>
            <CodeBlock title="Использование через заголовок X-API-Key" code="X-API-Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <div className="mt-3">
              <CodeBlock title="Или через Authorization" code="Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">🎫 JWT Токены (для веб-приложений)</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Получите токен через <code className="bg-[var(--bg-secondary)] px-1 rounded">POST /api/v3/auth/login</code>
            </p>
            <CodeBlock title="Использование JWT" code="Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
          </div>

          <CodeBlock title="Базовый URL" code="https://crm.hltrn.cc/api/v3" />
        </div>
      </section>

      {/* API Keys Management */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔑 Управление API ключами</h2>
        <div className="space-y-4">
          <ApiEndpoint
            method="GET"
            path="/api-keys"
            description="Получить список ваших API ключей"
          />
          <ApiEndpoint
            method="POST"
            path="/api-keys"
            description="Создать новый API ключ"
            body={{ name: "string", scopes: '["*"]', expires_in_days: "number?" }}
          />
          <ApiEndpoint
            method="DELETE"
            path="/api-keys/:id"
            description="Удалить (отозвать) API ключ"
          />

          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Доступные права (scopes)</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">*</code> — полный доступ</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:write</code></span>
            </div>
          </div>
        </div>
      </section>

      {/* Tables API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">📊 Таблицы API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables" description="Получить список всех таблиц" />
          <ApiEndpoint method="POST" path="/tables" description="Создать новую таблицу" body={{ name: "string", space_id: "number", emoji: "string?" }} />
          <ApiEndpoint method="GET" path="/tables/:id" description="Получить информацию о таблице" />
          <ApiEndpoint method="PATCH" path="/tables/:id" description="Обновить таблицу" body={{ name: "string?", emoji: "string?" }} />
          <ApiEndpoint method="DELETE" path="/tables/:id" description="Удалить таблицу" />
        </div>
      </section>

      {/* Columns API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">📋 Колонки API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/columns" description="Получить колонки таблицы" />
          <ApiEndpoint method="POST" path="/tables/:tableId/columns" description="Создать колонку" body={{ name: "string", type: "text|number|select|datetime|...", options: "object?" }} />
          <ApiEndpoint method="PATCH" path="/columns/:id" description="Обновить колонку" body={{ name: "string?", options: "object?" }} />
          <ApiEndpoint method="DELETE" path="/columns/:id" description="Удалить колонку" />

          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Типы колонок</h4>
            <div className="grid grid-cols-3 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• text</span>
              <span>• number</span>
              <span>• select</span>
              <span>• multi_select</span>
              <span>• datetime</span>
              <span>• time</span>
              <span>• checkbox</span>
              <span>• url</span>
              <span>• email</span>
              <span>• phone</span>
              <span>• rating</span>
              <span>• file</span>
              <span>• image</span>
              <span>• relation</span>
              <span>• lookup</span>
              <span>• formula</span>
              <span>• rollup</span>
              <span>• json</span>
              <span>• vector</span>
            </div>
          </div>
        </div>
      </section>

      {/* Rows API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">📝 Записи API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/rows" description="Получить записи таблицы" query="?limit=50&offset=0&sort=column_id&order=asc" />
          <ApiEndpoint method="POST" path="/tables/:tableId/rows" description="Создать запись" body={{ values: { "column_id": "value", "...": "..." } }} />
          <ApiEndpoint method="GET" path="/rows/:id" description="Получить запись по ID" />
          <ApiEndpoint method="PATCH" path="/rows/:id" description="Обновить запись" body={{ values: { "column_id": "new_value" } }} />
          <ApiEndpoint method="DELETE" path="/rows/:id" description="Удалить запись" />
          <ApiEndpoint method="POST" path="/tables/:tableId/rows/batch" description="Массовое создание записей" body={{ rows: [{ values: {} }, { values: {} }] }} />
        </div>
      </section>

      {/* Views API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">👁 Представления API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/views" description="Получить представления таблицы" />
          <ApiEndpoint method="POST" path="/tables/:tableId/views" description="Создать представление" body={{ name: "string", type: "table|kanban|calendar|gallery", config: "object" }} />
          <ApiEndpoint method="PATCH" path="/views/:id" description="Обновить представление" />
          <ApiEndpoint method="DELETE" path="/views/:id" description="Удалить представление" />
        </div>
      </section>

      {/* Widgets API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">📊 Виджеты API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/dashboards/:dashboardId/widgets" description="Получить виджеты дашборда" />
          <ApiEndpoint method="POST" path="/dashboards/:dashboardId/widgets" description="Создать виджет" body={{ type: "chart|stat|kanban|calendar|...", config: "object", position: { x: 0, y: 0, w: 2, h: 2 } }} />
          <ApiEndpoint method="PATCH" path="/widgets/:id" description="Обновить виджет" />
          <ApiEndpoint method="DELETE" path="/widgets/:id" description="Удалить виджет" />

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Типы виджетов</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• chart — графики</span>
              <span>• stat — статистика</span>
              <span>• kanban — канбан-доска</span>
              <span>• calendar — календарь</span>
              <span>• task_list — список задач</span>
              <span>• table — мини-таблица</span>
            </div>
          </div>
        </div>
      </section>

      {/* Webhooks API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔗 Вебхуки API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/webhooks" description="Получить вебхуки таблицы" />
          <ApiEndpoint method="POST" path="/tables/:tableId/webhooks" description="Создать вебхук" body={{ url: "string", events: ["row.created", "row.updated", "row.deleted"], secret: "string?" }} />
          <ApiEndpoint method="DELETE" path="/webhooks/:id" description="Удалить вебхук" />

          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">События вебхуков</h4>
            <div className="space-y-1 text-sm text-[var(--text-secondary)]">
              <p>• <code className="bg-[var(--bg-secondary)] px-1 rounded">row.created</code> — создание записи</p>
              <p>• <code className="bg-[var(--bg-secondary)] px-1 rounded">row.updated</code> — обновление записи</p>
              <p>• <code className="bg-[var(--bg-secondary)] px-1 rounded">row.deleted</code> — удаление записи</p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Sources API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔌 Внешние источники API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/data-sources" description="Получить список источников данных" />
          <ApiEndpoint method="POST" path="/data-sources" description="Создать внешний источник" body={{ name: "string", type: "postgres|mysql|api", connection: "object" }} />
          <ApiEndpoint method="POST" path="/data-sources/:id/sync" description="Синхронизировать данные" />
          <ApiEndpoint method="DELETE" path="/data-sources/:id" description="Удалить источник" />
        </div>
      </section>

      {/* Vector API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">✨ Vector API (Семантический поиск)</h2>
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-primary-500/10 border border-violet-500/30">
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Что это?</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Vector API позволяет создавать векторные эмбеддинги текста и искать похожие записи по смыслу,
              а не по точному совпадению слов. Использует OpenAI embeddings и PostgreSQL с расширением pgvector.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <span className="text-violet-400">Модель</span>
                <p className="text-[var(--text-tertiary)] mt-1">text-embedding-ada-002</p>
              </div>
              <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <span className="text-violet-400">Размерность</span>
                <p className="text-[var(--text-tertiary)] mt-1">1536 dimensions</p>
              </div>
              <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                <span className="text-violet-400">Сходство</span>
                <p className="text-[var(--text-tertiary)] mt-1">Cosine similarity</p>
              </div>
            </div>
          </div>

          <ApiEndpoint
            method="POST"
            path="/api/v3/ai/vector/embed"
            description="Создать и сохранить эмбеддинг для текста"
            body={{
              workspaceId: "number",
              tableId: "number",
              rowId: "number",
              text: "string",
              metadata: "object?"
            }}
          />

          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Пример запроса /embed</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-emerald-400 overflow-x-auto">
{`{
  "workspaceId": 1,
  "tableId": 5,
  "rowId": 123,
  "text": "Смартфон Apple iPhone 15 Pro 256GB Blue Titanium",
  "metadata": {
    "category": "electronics",
    "price": 99999
  }
}`}
            </pre>
          </div>

          <ApiEndpoint
            method="POST"
            path="/api/v3/ai/vector/search"
            description="Поиск похожих записей по тексту запроса"
            body={{
              workspaceId: "number",
              queryText: "string",
              tableId: "number?",
              limit: "number? (default: 10)",
              metadataFilters: "object?"
            }}
          />

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Пример запроса /search</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-emerald-400 overflow-x-auto">
{`{
  "workspaceId": 1,
  "queryText": "телефон айфон синий",
  "tableId": 5,
  "limit": 5,
  "metadataFilters": {
    "category": "electronics"
  }
}`}
            </pre>
            <h4 className="font-medium text-[var(--text-primary)] mt-3 mb-2">Пример ответа</h4>
            <pre className="p-3 bg-[var(--bg-primary)] rounded-lg text-xs text-primary-400 overflow-x-auto">
{`{
  "success": true,
  "results": [
    {
      "rowId": 123,
      "similarity": 0.94,
      "metadata": {
        "category": "electronics",
        "text_content": "Смартфон Apple iPhone 15 Pro 256GB Blue Titanium"
      }
    },
    {
      "rowId": 124,
      "similarity": 0.89,
      "metadata": {
        "text_content": "iPhone 15 Blue 128GB"
      }
    }
  ],
  "count": 2
}`}
            </pre>
          </div>

          <ApiEndpoint
            method="POST"
            path="/api/v3/ai/vector/batch"
            description="Массовое создание эмбеддингов"
            body={{
              workspaceId: "number",
              items: [
                { tableId: "number", rowId: "number", text: "string", metadata: "object?" }
              ]
            }}
          />

          <ApiEndpoint
            method="POST"
            path="/api/v3/ai/vector/generate-cell"
            description="Создать эмбеддинг для векторной колонки с учетом формулы"
            body={{
              tableId: "number",
              rowId: "number",
              columnId: "number"
            }}
          />

          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">💡 Как работает /generate-cell</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Этот эндпоинт читает настройки векторной колонки (formula, prefix, suffix),
              подставляет значения из других колонок строки, формирует итоговый текст и создаёт эмбеддинг.
            </p>
            <div className="space-y-2 text-xs">
              <div className="p-2 bg-[var(--bg-secondary)] rounded">
                <span className="text-violet-400">1. Формула колонки:</span>
                <code className="ml-2 text-[var(--text-secondary)]">Префикс: "Товар: " + Formula: {'{{title}} {{category}}'} + Суффикс: " в наличии"</code>
              </div>
              <div className="p-2 bg-[var(--bg-secondary)] rounded">
                <span className="text-violet-400">2. Данные строки:</span>
                <code className="ml-2 text-[var(--text-secondary)]">title: "iPhone 15", category: "Смартфоны"</code>
              </div>
              <div className="p-2 bg-[var(--bg-secondary)] rounded">
                <span className="text-violet-400">3. Итоговый текст:</span>
                <code className="ml-2 text-emerald-400">"Товар: iPhone 15 Смартфоны в наличии"</code>
              </div>
              <div className="p-2 bg-[var(--bg-secondary)] rounded">
                <span className="text-violet-400">4. Создание эмбеддинга через OpenAI API</span>
              </div>
            </div>
          </div>

          <ApiEndpoint
            method="GET"
            path="/api/v3/ai/vector/stats/:workspaceId"
            description="Получить статистику по эмбеддингам"
          />

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">⚙️ Требования</h4>
            <ul className="text-sm text-[var(--text-secondary)] space-y-1">
              <li>• <strong>OPENAI_API_KEY</strong> — API ключ OpenAI в переменных окружения</li>
              <li>• <strong>PostgreSQL + pgvector</strong> — база данных с расширением для векторов</li>
              <li>• <strong>База business_crm_vectors</strong> — отдельная БД для хранения эмбеддингов</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Example */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💡 Примеры использования</h2>
        <div className="space-y-4">
          <CodeBlock
            title="Создание записи (cURL)"
            code={`curl -X POST https://crm.hltrn.cc/api/tables/1/rows \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{
    "values": {
      "name": "Новый клиент",
      "email": "client@example.com",
      "status": "new"
    }
  }'`}
          />

          <CodeBlock
            title="JavaScript/Fetch"
            code={`const response = await fetch('/api/tables/1/rows', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    values: {
      name: 'Новый клиент',
      email: 'client@example.com',
    }
  })
});

const newRow = await response.json();
logger.debug('Created row:', newRow.id);`}
          />
        </div>
      </section>

      {/* Error Handling */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚠️ Обработка ошибок</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            API возвращает стандартные HTTP коды и JSON с описанием ошибки:
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-emerald-500">200</span>
              <span className="text-[var(--text-secondary)] ml-2">OK — успешно</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-emerald-500">201</span>
              <span className="text-[var(--text-secondary)] ml-2">Created — создано</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-yellow-500">400</span>
              <span className="text-[var(--text-secondary)] ml-2">Bad Request — ошибка запроса</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-yellow-500">401</span>
              <span className="text-[var(--text-secondary)] ml-2">Unauthorized — не авторизован</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">404</span>
              <span className="text-[var(--text-secondary)] ml-2">Not Found — не найдено</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">500</span>
              <span className="text-[var(--text-secondary)] ml-2">Server Error — ошибка сервера</span>
            </div>
          </div>
          <CodeBlock
            title="Формат ошибки"
            code={`{
  "error": true,
  "message": "Table not found",
  "code": "TABLE_NOT_FOUND"
}`}
          />
        </div>
      </section>
    </div>
  );
}
