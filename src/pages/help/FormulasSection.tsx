export function FormulasSection() {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Formulas and Variables</h2>
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-gradient-to-r from-primary-500/10 to-purple-500/10 border border-primary-500/30">
          <h3 className="font-semibold text-[var(--text-primary)] mb-3">Что такое формулы?</h3>
          <p className="text-[var(--text-secondary)] mb-3">
            Формулы позволяют автоматически вычислять значения на основе других колонок. Используйте переменные
            в фигурных скобках <code className="bg-[var(--bg-secondary)] px-1 rounded">{'{{column_name}}'}</code> для подстановки значений.
          </p>
          <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
            <p className="text-xs text-[var(--text-tertiary)] mb-1">Пример:</p>
            <code className="text-sm text-emerald-400">{'{{first_name}} {{last_name}} ({{email}})'}</code>
            <p className="text-xs text-[var(--text-tertiary)] mt-2">Результат:</p>
            <span className="text-sm text-[var(--text-primary)]">Иван Петров (ivan@example.com)</span>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-4">
          <h3 className="font-semibold text-[var(--text-primary)] mb-3">Синтаксис переменных</h3>
          <div className="space-y-3">
            <div>
              <code className="text-sm bg-primary-500/20 text-primary-400 px-2 py-1 rounded">{'{{column_name}}'}</code>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Базовая подстановка значения из колонки</p>
              <pre className="mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-secondary)]">
{'{{title}} - {{price}} ₽'}
              </pre>
            </div>

            <div>
              <code className="text-sm bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">{'{{value}}'}</code>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Текущее значение ячейки (для формул типа файл, вектор)</p>
              <pre className="mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-secondary)]">
{'Префикс: https://cdn.example.com/\nФормула: {{folder}}/{{value}}\nРезультат: https://cdn.example.com/images/photo.jpg'}
              </pre>
            </div>

            <div>
              <code className="text-sm bg-purple-500/20 text-purple-400 px-2 py-1 rounded">NOW()</code>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Специальная функция для текущей даты и времени</p>
              <pre className="mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-secondary)]">
{'Значение по умолчанию: NOW()\nРезультат: 2025-12-13T23:45:00'}
              </pre>
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-4">
          <h3 className="font-semibold text-[var(--text-primary)] mb-3">Где можно использовать формулы</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Текстовые колонки</h4>
              <p className="text-xs text-[var(--text-secondary)]">Шаблон отображения, префикс, суффикс</p>
            </div>
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Файлы и изображения</h4>
              <p className="text-xs text-[var(--text-secondary)]">Формула пути, префикс URL</p>
            </div>
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">URL колонки</h4>
              <p className="text-xs text-[var(--text-secondary)]">Шаблон ссылки, текст ссылки</p>
            </div>
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Векторные колонки</h4>
              <p className="text-xs text-[var(--text-secondary)]">Формула векторизации текста</p>
            </div>
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Кнопки</h4>
              <p className="text-xs text-[var(--text-secondary)]">URL для перехода, webhook endpoint</p>
            </div>
            <div className="p-3 rounded bg-[var(--bg-tertiary)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Значения по умолчанию</h4>
              <p className="text-xs text-[var(--text-secondary)]">Для любого типа колонки</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-500/30 p-4">
          <h3 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <span>Практические примеры формул</span>
          </h3>
          <div className="space-y-3 text-sm">
            <div className="p-3 bg-[var(--bg-secondary)] rounded">
              <strong className="text-primary-400">Полное имя:</strong>
              <code className="block mt-1 text-[var(--text-secondary)]">{'{{first_name}} {{middle_name}} {{last_name}}'}</code>
            </div>
            <div className="p-3 bg-[var(--bg-secondary)] rounded">
              <strong className="text-emerald-400">URL товара:</strong>
              <code className="block mt-1 text-[var(--text-secondary)]">{'https://shop.com/products/{{id}}/{{slug}}'}</code>
            </div>
            <div className="p-3 bg-[var(--bg-secondary)] rounded">
              <strong className="text-purple-400">Путь к файлу:</strong>
              <code className="block mt-1 text-[var(--text-secondary)]">{'{{year}}/{{month}}/{{category}}/{{filename}}'}</code>
            </div>
            <div className="p-3 bg-[var(--bg-secondary)] rounded">
              <strong className="text-pink-400">Описание для поиска:</strong>
              <code className="block mt-1 text-[var(--text-secondary)]">{'{{brand}} {{model}} {{color}} {{size}}'}</code>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <h3 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
            <span>Важные замечания</span>
          </h3>
          <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
            <li>Если колонка не существует, <code className="bg-red-500/20 text-red-400 px-1 rounded">{'{{unknown}}'}</code> будет выделена красным</li>
            <li>Существующие колонки подсвечиваются <code className="bg-emerald-500/20 text-emerald-400 px-1 rounded">{'{{name}}'}</code> зелёным</li>
            <li>Формулы пересчитываются автоматически при изменении исходных данных</li>
            <li>В формулах учитывается регистр: <code>{'{{Name}}'}</code> ≠ <code>{'{{name}}'}</code></li>
          </ul>
        </div>
      </div>
    </section>
  );
}
