import {
  Eye, Table2, LayoutGrid, Calendar, GitBranch,
  BarChart3, ListTodo, Image,
} from 'lucide-react';
import { ViewTypeCard } from './HelpCards';

export function ViewsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Eye className="inline w-8 h-8 mr-2 text-cyan-500" />
          Представления
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Одни и те же данные можно отображать по-разному. Представления позволяют выбрать
          наиболее удобный формат для текущей задачи.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Типы представлений</h2>
        <div className="space-y-4">
          <ViewTypeCard
            icon={<Table2 className="w-6 h-6" />}
            title="Таблица"
            description="Классический табличный вид со всеми колонками. Идеален для детального просмотра и редактирования данных."
            color="purple"
            useCases={['CRM с контактами', 'Инвентарь', 'База данных']}
          />
          <ViewTypeCard
            icon={<LayoutGrid className="w-6 h-6" />}
            title="Канбан"
            description="Карточки, сгруппированные по колонкам статуса. Перетаскивайте карточки между колонками."
            color="cyan"
            useCases={['Трекер задач', 'Процесс продаж', 'Найм сотрудников']}
          />
          <ViewTypeCard
            icon={<Calendar className="w-6 h-6" />}
            title="Календарь"
            description="Записи отображаются на календаре по датам. Поддерживает события с длительностью."
            color="emerald"
            useCases={['Встречи', 'Дедлайны', 'Контент-план']}
          />
          <ViewTypeCard
            icon={<GitBranch className="w-6 h-6" />}
            title="Таймлайн"
            description="Gantt-диаграмма с датами начала и окончания. Видна длительность и пересечения."
            color="amber"
            useCases={['Проекты', 'Roadmap', 'Планирование']}
          />
          <ViewTypeCard
            icon={<Image className="w-6 h-6" />}
            title="Галерея"
            description="Карточки с превью изображений. Отлично для визуального контента."
            color="pink"
            useCases={['Портфолио', 'Каталог товаров', 'Мудборды']}
          />
          <ViewTypeCard
            icon={<ListTodo className="w-6 h-6" />}
            title="Чек-лист"
            description="Список задач с чекбоксами. Отмечайте выполненное, следите за прогрессом."
            color="green"
            useCases={['To-do листы', 'Чек-листы', 'Привычки']}
          />
          <ViewTypeCard
            icon={<BarChart3 className="w-6 h-6" />}
            title="График"
            description="Визуализация данных в виде графиков: столбчатые, линейные, круговые."
            color="indigo"
            useCases={['Аналитика', 'Отчёты', 'Метрики']}
          />
        </div>
      </section>
    </div>
  );
}
