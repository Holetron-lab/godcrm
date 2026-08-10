import {
  Filter, Search, ArrowUpDown,
} from 'lucide-react';
import { FilterTypeCard } from './SharedComponents';

export function FiltersSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Filter className="inline w-8 h-8 mr-2 text-emerald-500" />
          Фильтры и поиск
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Фильтры помогают найти нужные записи в большом объёме данных. Комбинируйте условия
          для точного результата.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Поиск</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <Search className="w-5 h-5 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-primary)]">Быстрый поиск по всем текстовым полям</span>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Введите текст в поле поиска — результаты обновятся мгновенно</li>
            <li>• Поиск работает по названию и текстовым колонкам</li>
            <li>• Можно выбрать конкретные колонки для поиска</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Типы фильтров</h2>
        <div className="space-y-4">
          <FilterTypeCard
            title="Фильтр по выбору"
            description="Показать записи с определёнными значениями в колонке типа Select/Multiselect"
            example="Статус = 'В работе' ИЛИ 'На проверке'"
          />
          <FilterTypeCard
            title="Фильтр по дате"
            description="Показать записи в определённом диапазоне дат"
            example="Дедлайн: с 1 декабря по 31 декабря"
          />
          <FilterTypeCard
            title="Комбинированные фильтры"
            description="Несколько фильтров применяются одновременно (условие И)"
            example="Статус = 'В работе' И Исполнитель = 'Иван'"
          />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Сортировка</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <ArrowUpDown className="w-5 h-5 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-primary)]">Упорядочивание записей</span>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Клик по заголовку колонки — сортировка по возрастанию</li>
            <li>• Повторный клик — сортировка по убыванию</li>
            <li>• Работает для текста, чисел и дат</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
