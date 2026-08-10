import {
  Layers, FolderKanban, LayoutGrid, Palette,
} from 'lucide-react';
import { ExampleCard } from './HelpCards';

export function SpacesSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Layers className="inline w-8 h-8 mr-2 text-primary-500" />
          Пространства
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Пространства — это верхний уровень организации в GOD CRM. Используйте их для разделения
          разных областей работы или жизни.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Что такое пространство?</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <FolderKanban className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Проекты</strong> — пространство содержит проекты,
                каждый со своим набором таблиц и настроек
              </span>
            </li>
            <li className="flex items-start gap-3">
              <LayoutGrid className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Дашборд</strong> — у каждого пространства есть
                дашборд с виджетами для быстрого обзора
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Palette className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Кастомизация</strong> — название, иконка и цвет
                для быстрой визуальной идентификации
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Примеры использования</h2>
        <div className="grid grid-cols-2 gap-4">
          <ExampleCard emoji="💼" title="Работа" items={['CRM клиентов', 'Трекер задач', 'База знаний']} />
          <ExampleCard emoji="🏠" title="Личное" items={['Финансы', 'Привычки', 'Цели на год']} />
          <ExampleCard emoji="🚀" title="Стартап" items={['Roadmap', 'Инвесторы', 'Метрики']} />
          <ExampleCard emoji="📚" title="Обучение" items={['Курсы', 'Книги', 'Заметки']} />
        </div>
      </section>
    </div>
  );
}
