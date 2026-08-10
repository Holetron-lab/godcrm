import {
  Bot, MessageSquare, Cpu, RefreshCw,
} from 'lucide-react';

export function AIAgentsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Bot className="inline w-8 h-8 mr-2 text-violet-500" />
          AI Агенты
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Интеллектуальные помощники, которые понимают ваши данные и помогают работать с ними.
          Агенты могут отвечать на вопросы, анализировать данные и выполнять задачи.
        </p>
      </header>

      {/* What are AI Agents */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🤖 Что такое AI Агенты?</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <p className="text-[var(--text-secondary)] mb-4">
            AI Агенты — это настраиваемые AI-помощники на базе GPT-4, Claude или других моделей.
            Каждый агент имеет свою роль, знания и инструменты.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-violet-500/10 border border-violet-500/30">
              <Bot className="w-6 h-6 text-violet-500 mb-2" />
              <h4 className="font-medium text-[var(--text-primary)]">Персонализация</h4>
              <p className="text-sm text-[var(--text-secondary)]">Настройте системный промпт, модель и инструменты под свои задачи</p>
            </div>
            <div className="p-4 rounded-lg bg-primary-500/10 border border-primary-500/30">
              <MessageSquare className="w-6 h-6 text-primary-500 mb-2" />
              <h4 className="font-medium text-[var(--text-primary)]">Контекст данных</h4>
              <p className="text-sm text-[var(--text-secondary)]">Агент понимает структуру ваших таблиц и может работать с данными</p>
            </div>
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Cpu className="w-6 h-6 text-emerald-500 mb-2" />
              <h4 className="font-medium text-[var(--text-primary)]">Множество провайдеров</h4>
              <p className="text-sm text-[var(--text-secondary)]">OpenAI, Anthropic, Google, Ollama — выбирайте подходящую модель</p>
            </div>
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <RefreshCw className="w-6 h-6 text-amber-500 mb-2" />
              <h4 className="font-medium text-[var(--text-primary)]">Мониторинг</h4>
              <p className="text-sm text-[var(--text-secondary)]">Отслеживание использования токенов, стоимости и качества ответов</p>
            </div>
          </div>
        </div>
      </section>

      {/* Getting Started */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🚀 Быстрый старт</h2>
        <ol className="space-y-4">
          <li className="flex items-start gap-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500 text-white font-semibold flex items-center justify-center">1</span>
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Создайте пространство "AI Agents"</h4>
              <p className="text-sm text-[var(--text-secondary)]">
                Или используйте существующее. В пространстве должны быть таблицы: Agents, Models, Providers, API Keys.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500 text-white font-semibold flex items-center justify-center">2</span>
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Добавьте API ключ провайдера</h4>
              <p className="text-sm text-[var(--text-secondary)]">
                В таблицу API Keys добавьте ключ от OpenAI, Anthropic или другого провайдера.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500 text-white font-semibold flex items-center justify-center">3</span>
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Создайте агента</h4>
              <p className="text-sm text-[var(--text-secondary)]">
                В таблице Agents создайте запись с именем, описанием, системным промптом и выбором модели.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500 text-white font-semibold flex items-center justify-center">4</span>
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Начните диалог</h4>
              <p className="text-sm text-[var(--text-secondary)]">
                Нажмите на иконку чата в правом нижнем углу и выберите агента.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* Agent Configuration */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚙️ Настройка агента</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">name</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Имя агента для отображения в списке</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">description</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Краткое описание назначения агента</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">system_prompt</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Системный промпт, определяющий поведение и роль агента</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">model</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Связь с таблицей Models — выбор AI модели</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">provider_id</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Связь с таблицей Providers — выбор провайдера API</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">api_key_id</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Связь с таблицей API Keys — ключ для авторизации</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">tools</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">JSON массив доступных инструментов агента</p>
          </div>
          <div className="p-4">
            <code className="text-violet-400 font-mono text-sm">is_active</code>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Checkbox — активен ли агент для использования</p>
          </div>
        </div>
      </section>

      {/* Vector Search Integration */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">✨ AI агенты и векторный поиск</h2>
        <div className="bg-gradient-to-r from-violet-500/10 to-primary-500/10 rounded-xl p-6 border border-violet-500/30">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl flex-shrink-0">
              🔍
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Семантический поиск данных</h3>
              <p className="text-[var(--text-secondary)]">
                AI агенты могут использовать векторный поиск для интеллектуального анализа данных. Вместо точного
                совпадения слов, агент понимает смысл запроса и находит релевантные записи.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <h4 className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                <span className="text-xl">💡</span>
                Пример 1: Поиск похожих товаров
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded text-xs">Вопрос</span>
                  <span className="text-[var(--text-secondary)]">"Найди товары похожие на iPhone 15"</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">Агент</span>
                  <span className="text-[var(--text-secondary)]">
                    Использует Vector API для поиска товаров с похожими характеристиками: смартфоны премиум-класса,
                    большой экран, хорошая камера → находит Samsung S24 Ultra, Google Pixel 8 Pro
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <h4 className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                <span className="text-xl">📄</span>
                Пример 2: Поиск документов по смыслу
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded text-xs">Вопрос</span>
                  <span className="text-[var(--text-secondary)]">"Где информация про работу с клиентами?"</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">Агент</span>
                  <span className="text-[var(--text-secondary)]">
                    Ищет документы семантически связанные с CRM, клиентским сервисом, продажами →
                    находит "CRM Руководство", "Обработка заявок", "Скрипты продаж"
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <h4 className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                <span className="text-xl">🎯</span>
                Пример 3: Рекомендации
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded text-xs">Вопрос</span>
                  <span className="text-[var(--text-secondary)]">"Что ещё может понравиться клиенту, который купил ноутбук для дизайна?"</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">Агент</span>
                  <span className="text-[var(--text-secondary)]">
                    Анализирует покупку через векторный поиск → рекомендует графический планшет, внешний монитор 4K,
                    мышь для дизайнеров, подписку Adobe Creative Cloud
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">🛠️ Как включить векторный поиск для агента</h4>
            <ol className="text-sm text-[var(--text-secondary)] space-y-2">
              <li>1. Создайте векторную колонку в нужной таблице</li>
              <li>2. Настройте формулу векторизации (какие поля включать)</li>
              <li>3. Добавьте инструмент <code className="bg-[var(--bg-secondary)] px-1 rounded">vector_search</code> агенту</li>
              <li>4. В системном промпте укажите, когда использовать векторный поиск</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Supported Providers */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔌 Поддерживаемые провайдеры</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-500 text-lg">🟢</div>
              <div>
                <h4 className="font-medium text-[var(--text-primary)]">OpenAI</h4>
                <p className="text-xs text-[var(--text-secondary)]">GPT-4, GPT-4 Turbo, GPT-3.5</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-500 text-lg">🟠</div>
              <div>
                <h4 className="font-medium text-[var(--text-primary)]">Anthropic</h4>
                <p className="text-xs text-[var(--text-secondary)]">Claude 3.5, Claude 3 Opus</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center text-primary-500 text-lg">🔵</div>
              <div>
                <h4 className="font-medium text-[var(--text-primary)]">Google</h4>
                <p className="text-xs text-[var(--text-secondary)]">Gemini 1.5 Pro, Gemini Flash</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-500 text-lg">🟣</div>
              <div>
                <h4 className="font-medium text-[var(--text-primary)]">Ollama</h4>
                <p className="text-xs text-[var(--text-secondary)]">Llama 3.2, Mistral, CodeLlama</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Message Logs */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">📝 Логи сообщений</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <p className="text-[var(--text-secondary)] mb-4">
            Все взаимодействия с агентами автоматически логируются в таблицу "Message Logs":
          </p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">agent_name</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">user_id</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">model</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">message</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">response</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">tokens_in/out</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">status</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-primary)]">
              <span className="text-[var(--text-tertiary)]">timestamp</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tips */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💡 Советы</h2>
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-1">Системный промпт</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Чётко определите роль агента. Например: "Ты аналитик продаж. Отвечай кратко и по делу."
            </p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-1">Выбор модели</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              GPT-4 Turbo для сложных задач, GPT-3.5 для простых — экономьте токены разумно.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-1">Переменные в промптах</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Используйте шаблоны вида {'{{table.column}}'} для динамической подстановки данных из таблиц.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
