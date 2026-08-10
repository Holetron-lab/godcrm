import {
  Database, Plus, FileSpreadsheet, Upload, Download,
} from 'lucide-react';
import { ActionCard } from './HelpCards';

export function TablesSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Database className="inline w-8 h-8 mr-2 text-purple-500" />
          Таблицы
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Таблицы — основа GOD CRM. Каждая запись в таблице — это объект с набором свойств,
          которые вы определяете сами.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Создание таблицы</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">1</span>
              <span className="text-[var(--text-secondary)]">
                Перейдите в проект и нажмите <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Создать таблицу</kbd>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">2</span>
              <span className="text-[var(--text-secondary)]">
                Укажите название, иконку и описание таблицы
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">3</span>
              <span className="text-[var(--text-secondary)]">
                Добавьте колонки (поля) — они определяют структуру данных
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">4</span>
              <span className="text-[var(--text-secondary)]">
                Начните добавлять записи через кнопку <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Добавить</kbd>
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Операции с записями</h2>
        <div className="grid grid-cols-2 gap-4">
          <ActionCard icon={<Plus />} title="Добавить" description="Создайте новую запись в таблице" />
          <ActionCard icon={<FileSpreadsheet />} title="Редактировать" description="Двойной клик открывает карточку записи" />
          <ActionCard icon={<Upload />} title="Импорт" description="Загрузите данные из CSV файла" />
          <ActionCard icon={<Download />} title="Экспорт" description="Выгрузите данные в CSV или Excel" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">✅ Выделение и массовые операции</h2>
        <div className="space-y-6">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
            <h3 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span className="text-xl">☑️</span>
              Построчное выделение
            </h3>
            <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
              <li>• Чекбокс слева от каждой строки для выделения</li>
              <li>• Чекбокс в заголовке — выделить/снять все видимые строки</li>
              <li>• Выделенные строки подсвечиваются цветом</li>
              <li>• Горячие клавиши: Shift+Click для диапазона, Ctrl+A для всех</li>
            </ul>
          </div>

          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
            <h3 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span className="text-xl">🗃️</span>
              Контейнер выделенных
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Badge справа от кнопки "Фильтры" показывает количество выделенных строк.
              Клик открывает меню с действиями:
            </p>
            <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">○</span>
                <span className="text-[var(--text-secondary)]">По умолчанию — без сортировки</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">●</span>
                <span className="text-[var(--text-secondary)]">Выделенные сверху — показать выделенные первыми</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">○</span>
                <span className="text-[var(--text-secondary)]">Выделенные снизу — показать выделенные последними</span>
              </div>
              <hr className="border-[var(--border-primary)] my-2" />
              <div className="text-[var(--text-tertiary)]">
                • Снять выделение — очистить всё<br />
                • Выбрать все отфильтрованные — выделить результаты фильтров
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-primary-500/10 to-purple-500/10 rounded-xl p-6 border border-primary-500/30">
            <h3 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <span className="text-xl">🔄</span>
              Массовая замена (Find & Replace)
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Кнопка "🔄 Замена" справа от контейнера открывает модалку для массового изменения данных.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">📋 Применить к:</h4>
                <ul className="text-sm text-[var(--text-secondary)] space-y-1 ml-4">
                  <li>• Выделенным строкам — только отмеченные чекбоксами</li>
                  <li>• Отфильтрованным строкам — результаты текущих фильтров</li>
                  <li>• Всем строкам — вся таблица без ограничений</li>
                </ul>
              </div>

              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">⚙️ Типы операций:</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <code className="text-violet-400">Заменить значение</code>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">Draft → Active</p>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <code className="text-violet-400">Добавить (prefix/suffix)</code>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">Hello → Hello World</p>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <code className="text-violet-400">Очистить значение</code>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">Text → (пусто)</p>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <code className="text-violet-400">Применить формулу</code>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{'{name}'} - {'{code}'}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">🎯 Дополнительно:</h4>
                <ul className="text-sm text-[var(--text-secondary)] space-y-1 ml-4">
                  <li>• Поддержка регулярных выражений (regex)</li>
                  <li>• Учёт регистра (case sensitive)</li>
                  <li>• Предпросмотр изменений перед применением</li>
                  <li>• Отображение количества затронутых строк</li>
                </ul>
              </div>

              <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30 text-sm">
                <p className="text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <span>💡</span>
                  <span>Пример: найти "Draft" и заменить на "Active" в колонке Status для 5 выделенных строк</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
