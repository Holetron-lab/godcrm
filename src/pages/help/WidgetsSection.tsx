import {
  LayoutGrid, Table2, Calendar, GitBranch, BarChart3, ListTodo,
} from 'lucide-react';
import { WidgetCard } from './SharedComponents';

export function WidgetsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <LayoutGrid className="inline w-8 h-8 mr-2 text-pink-500" />
          Виджеты и дашборды
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Виджеты позволяют вынести данные из таблиц на дашборд в удобном формате.
          Создавайте обзорные панели для быстрого мониторинга.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Создание виджета</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">1</span>
              <span className="text-[var(--text-secondary)]">
                Перейдите на дашборд пространства и нажмите <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Добавить виджет</kbd>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">2</span>
              <span className="text-[var(--text-secondary)]">
                Выберите тип представления (канбан, календарь, график и т.д.)
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">3</span>
              <span className="text-[var(--text-secondary)]">
                Укажите таблицу-источник данных
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">4</span>
              <span className="text-[var(--text-secondary)]">
                Настройте маппинг полей и фильтры в настройках виджета
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Типы виджетов</h2>
        <div className="grid grid-cols-2 gap-4">
          <WidgetCard icon={<Table2 />} name="Таблица" color="purple" />
          <WidgetCard icon={<LayoutGrid />} name="Канбан" color="cyan" />
          <WidgetCard icon={<Calendar />} name="Календарь" color="emerald" />
          <WidgetCard icon={<GitBranch />} name="Таймлайн" color="amber" />
          <WidgetCard icon={<BarChart3 />} name="График" color="pink" />
          <WidgetCard icon={<ListTodo />} name="Чек-лист" color="green" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Управление дашбордом</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ul className="space-y-3 text-[var(--text-secondary)]">
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">📐</span>
              <span><strong className="text-[var(--text-primary)]">Изменение размера</strong> — перетащите угол виджета</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">↕️</span>
              <span><strong className="text-[var(--text-primary)]">Перемещение</strong> — перетащите виджет за заголовок</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">⚙️</span>
              <span><strong className="text-[var(--text-primary)]">Настройки</strong> — нажмите шестерёнку в углу виджета</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">🗑️</span>
              <span><strong className="text-[var(--text-primary)]">Удаление</strong> — через меню настроек виджета</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
