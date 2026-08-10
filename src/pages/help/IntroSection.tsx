import {
  Database, Eye, LayoutGrid, Zap,
} from 'lucide-react';
import { FeatureCard, QuickStartStep } from './HelpCards';

export function IntroSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          Добро пожаловать в GOD CRM
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          GOD CRM — это гибкая система управления данными, которая позволяет организовать информацию
          так, как удобно именно вам. Создавайте таблицы, настраивайте представления и автоматизируйте
          рутинные задачи.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <FeatureCard
          icon={<Database className="w-6 h-6" />}
          title="Таблицы"
          description="Храните любые данные в структурированных таблицах с кастомными полями"
          color="purple"
        />
        <FeatureCard
          icon={<Eye className="w-6 h-6" />}
          title="Представления"
          description="Смотрите на данные по-разному: таблица, канбан, календарь, галерея"
          color="cyan"
        />
        <FeatureCard
          icon={<LayoutGrid className="w-6 h-6" />}
          title="Виджеты"
          description="Создавайте дашборды с визуализацией данных из разных таблиц"
          color="emerald"
        />
        <FeatureCard
          icon={<Zap className="w-6 h-6" />}
          title="Автоматизации"
          description="Автоматизируйте действия при изменении данных"
          color="amber"
        />
      </div>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Быстрый старт</h2>
        <ol className="space-y-4">
          <QuickStartStep
            number={1}
            title="Создайте пространство"
            description="Пространство — это контейнер для ваших проектов и таблиц. Например: «Работа», «Личное», «Стартап»."
          />
          <QuickStartStep
            number={2}
            title="Добавьте таблицу"
            description="Таблица хранит ваши данные. Каждая запись — это строка с набором полей (колонок)."
          />
          <QuickStartStep
            number={3}
            title="Настройте представление"
            description="Выберите как отображать данные: таблица для детального просмотра, канбан для задач, календарь для событий."
          />
          <QuickStartStep
            number={4}
            title="Добавьте виджеты на дашборд"
            description="Выведите ключевые метрики и данные на дашборд пространства."
          />
        </ol>
      </section>
    </div>
  );
}
