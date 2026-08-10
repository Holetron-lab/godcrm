import { Columns } from 'lucide-react';
/**
 * COLUMN_TYPE_METADATA - единый источник правды для типов колонок.
 * При добавлении нового типа колонки - сначала добавь его в:
 * @see /src/shared/types/index.ts - COLUMN_TYPE_METADATA
 * Затем добавь документацию в секцию ColumnsSection ниже.
 */
import { COLUMN_TYPE_METADATA } from '@/shared/types';
import { ColumnTypeAccordion, SettingCard } from './SharedComponents';
import { FormulasSection } from './FormulasSection';

export function ColumnsSection() {
  /**
   * Типы колонок документируются здесь вручную с подробностями.
   * Список типов должен соответствовать COLUMN_TYPE_METADATA из @/shared/types.
   *
   * Текущие типы (${Object.keys(COLUMN_TYPE_METADATA).length}):
   * ${Object.keys(COLUMN_TYPE_METADATA).join(', ')}
   *
   * При добавлении нового типа в COLUMN_TYPE_METADATA - добавь ColumnTypeAccordion ниже!
   */
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Columns className="inline w-8 h-8 mr-2 text-amber-500" />
          Типы колонок
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Колонки определяют какие данные можно хранить в таблице. Выбирайте правильный тип
          для валидации и удобного редактирования.
        </p>
        {/* Показываем актуальный счетчик типов из COLUMN_TYPE_METADATA */}
        <p className="text-sm text-[var(--text-tertiary)] mt-2">
          Всего типов: {Object.keys(COLUMN_TYPE_METADATA).length} (синхронизировано с кодом)
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Доступные типы</h2>
        <div className="space-y-2">
          <ColumnTypeAccordion
            type="text"
            name="📝 Текст"
            description="Любой текст, заметки, описания"
            details={{
              features: [
                'Шаблон отображения с переменными: {{name}} ({{code}})',
                'Префикс и суффикс для форматирования',
                'Поддержка формул в значении по умолчанию',
                'Перенос текста: одна строка, авто-перенос, ограниченный'
              ],
              settings: [
                { name: 'formula', desc: 'Шаблон с переменными из других колонок' },
                { name: 'prefix', desc: 'Текст перед значением' },
                { name: 'suffix', desc: 'Текст после значения' },
                { name: 'defaultValue', desc: 'Значение по умолчанию для новых строк' }
              ],
              example: 'Шаблон: {{first_name}} {{last_name}} → Иван Иванов'
            }}
          />
          <ColumnTypeAccordion
            type="number"
            name="🔢 Число"
            description="Числа, суммы, количество"
            details={{
              features: [
                'Форматы: обычное число, валюта (₽), процент (%)',
                'Минимальное и максимальное значение',
                'Шаг для кнопок +/- в ячейке',
                'Количество знаков после запятой'
              ],
              settings: [
                { name: 'format', desc: 'number | currency | percent' },
                { name: 'min / max', desc: 'Ограничения значений' },
                { name: 'step', desc: 'Шаг изменения (по умолчанию 1)' },
                { name: 'decimals', desc: 'Знаков после запятой (0-10)' }
              ],
              example: 'Формат: currency, decimals: 2 → 1 234,50 ₽'
            }}
          />
          <ColumnTypeAccordion
            type="select"
            name="📋 Выбор (Select)"
            description="Одно значение из списка опций с цветами"
            details={{
              features: [
                'Список опций с цветовой кодировкой',
                'Импорт опций из CSV или другой таблицы',
                'Автоматический сбор опций из существующих данных',
                'Поддержка relation для подгрузки из связанной таблицы'
              ],
              settings: [
                { name: 'options', desc: 'Массив { id, label, color }' },
                { name: 'relation.tableId', desc: 'Таблица-источник опций' },
                { name: 'relation.valueColumn', desc: 'Колонка со значениями' },
                { name: 'relation.labelColumn', desc: 'Колонка с лейблами' }
              ],
              example: 'Статус: ● Новый | ● В работе | ● Готово'
            }}
          />
          <ColumnTypeAccordion
            type="multi-select"
            name="🏷️ Мульти-выбор (Multi-Select)"
            description="Несколько значений из списка (теги, категории)"
            details={{
              features: [
                'Выбор нескольких значений из списка',
                'Режим relation — подгрузка опций из связанной таблицы',
                '4 формата отображения: badges, list, count, first',
                '4 формата хранения: json, comma, semicolon, newline'
              ],
              settings: [
                { name: 'relation.tableId', desc: 'Таблица с опциями' },
                { name: 'relation.valueColumn', desc: 'Колонка со значениями (id)' },
                { name: 'relation.labelColumn', desc: 'Колонка с лейблами' },
                { name: 'relation.colorColumn', desc: 'Колонка с цветами (опционально)' },
                { name: 'relation.displayMode', desc: 'badges | list | count | first' },
                { name: 'relation.storageFormat', desc: 'json | comma | semicolon | newline' }
              ],
              example: 'Теги: [React] [TypeScript] [Node.js] или "3 тега"'
            }}
          />
          <ColumnTypeAccordion
            type="datetime"
            name="📅 Дата и время"
            description="Конкретная дата и время"
            details={{
              features: [
                '3 формата хранения: ISO 8601, Unix (сек), Unix (мс)',
                'Выбор часового пояса: UTC или браузерный',
                '11 форматов отображения',
                'Поддержка NOW() для текущей даты'
              ],
              settings: [
                { name: 'storageFormat', desc: 'ISO8601 | unix | unix_ms' },
                { name: 'timezone', desc: 'UTC | browser' },
                { name: 'displayFormat', desc: '25.12.2024 10:30, 25 декабря 2024, и др.' }
              ],
              example: 'Хранение: 2024-12-25T10:30:00Z → Показ: 25 декабря 2024, 13:30'
            }}
          />
          <ColumnTypeAccordion
            type="time"
            name="⏰ Время (Cron)"
            description="Расписание для cron-задач (HH:MM, день месяца)"
            details={{
              features: [
                'Ввод времени в формате HH:MM',
                'Выбор дня месяца для периодических задач',
                'Интеграция с автоматизациями',
                'Визуальный редактор расписания'
              ],
              settings: [
                { name: 'format', desc: 'HH:MM | cron expression' },
                { name: 'dayOfMonth', desc: 'День месяца (1-31)' },
                { name: 'repeatType', desc: 'daily | weekly | monthly' }
              ],
              example: '09:00 каждый день или 15:30 каждое 1-е число месяца'
            }}
          />
          <ColumnTypeAccordion
            type="checkbox"
            name="☑️ Чекбокс"
            description="Да/Нет, включено/выключено"
            details={{
              features: [
                'Настраиваемые значения для Да/Нет',
                '3 стиля: галочка, переключатель, да/нет',
                'Значение по умолчанию'
              ],
              settings: [
                { name: 'trueValue', desc: 'Значение для "Да" (1, true, yes...)' },
                { name: 'falseValue', desc: 'Значение для "Нет" (0, false, no...)' },
                { name: 'style', desc: 'checkbox | toggle | yesno' }
              ],
              example: 'Стиль toggle: [○━━] ВКЛ / [━━○] ВЫКЛ'
            }}
          />
          <ColumnTypeAccordion
            type="url"
            name="🔗 URL (ссылка)"
            description="Ссылки на сайты и ресурсы"
            details={{
              features: [
                'Шаблон URL с переменными из других колонок',
                'Настраиваемый текст ссылки',
                'Открытие в новой вкладке',
                'Превью ссылки'
              ],
              settings: [
                { name: 'template', desc: 'Шаблон: https://site.com/{{id}}' },
                { name: 'linkText', desc: 'Текст вместо URL' }
              ],
              example: 'Шаблон: https://shop.com/products/{{slug}} → Открыть товар'
            }}
          />
          <ColumnTypeAccordion
            type="email"
            name="📧 Email"
            description="Электронная почта"
            details={{
              features: [
                '4 формата отображения',
                'Кнопка "Написать письмо"',
                'Копирование по клику',
                'Маскирование для конфиденциальности'
              ],
              settings: [
                { name: 'displayFormat', desc: 'full | link | masked | domain' }
              ],
              example: 'Masked: u***@e***.com, Domain: @example.com'
            }}
          />
          <ColumnTypeAccordion
            type="phone"
            name="📱 Телефон"
            description="Номера телефонов"
            details={{
              features: [
                '4 формата отображения',
                'Автоформатирование по стране',
                'Кнопки: позвонить, WhatsApp, Telegram',
                'Маскирование для конфиденциальности'
              ],
              settings: [
                { name: 'format', desc: 'full | national | international | masked' },
                { name: 'country', desc: 'ru | us | uk | de' }
              ],
              example: '+79001234567 → 8 (900) 123-45-67 (RU) или +7 *** ***-**-67'
            }}
          />
          <ColumnTypeAccordion
            type="file"
            name="📁 Файл"
            description="Загрузка файлов"
            details={{
              features: [
                'Загрузка одного или нескольких файлов',
                'Формула для вычисляемого пути',
                'Префикс (домен) и суффикс (параметры)',
                'Форматы: полный URL, имя файла, путь'
              ],
              settings: [
                { name: 'formula', desc: 'Шаблон: {{folder}}/{{filename}}' },
                { name: 'prefix', desc: 'Например: https://cdn.site.com/' },
                { name: 'suffix', desc: 'Например: ?v=2' }
              ],
              example: 'prefix + formula → https://cdn.site.com/docs/report.pdf'
            }}
          />
          <ColumnTypeAccordion
            type="image"
            name="🖼️ Изображение"
            description="Загрузка и отображение изображений"
            details={{
              features: [
                '4 режима галереи: стек, карусель, сетка, одно фото',
                'Настраиваемая высота (32-200px)',
                'Форма: квадрат, скруглённый, круг',
                'Лайтбокс при клике'
              ],
              settings: [
                { name: 'galleryMode', desc: 'stack | carousel | grid | single' },
                { name: 'height', desc: 'Высота в пикселях (32-200)' },
                { name: 'shape', desc: 'square | rounded | circle' },
                { name: 'fit', desc: 'cover | contain | fill' }
              ],
              example: 'Режим stack: [📷][📷][📷] +3 фото'
            }}
          />
          <ColumnTypeAccordion
            type="person"
            name="👤 Пользователь"
            description="Ссылка на пользователя системы"
            details={{
              features: [
                '3 источника: системные пользователи, из таблицы, ручной ввод',
                '5 форматов отображения',
                'Аватар и имя'
              ],
              settings: [
                { name: 'source', desc: 'system | table | manual' },
                { name: 'displayFormat', desc: 'name | avatar | avatar_name | email | card' }
              ],
              example: '[👤] Иван Иванов или [📧] ivan@company.com'
            }}
          />
          <ColumnTypeAccordion
            type="relation"
            name="🔗 Связь (Relation)"
            description="Ссылка на запись из другой таблицы"
            details={{
              features: [
                'Выбор связанной таблицы',
                'Настраиваемая колонка для отображения',
                'Переход к связанной записи по клику',
                'Множественная связь (многие-ко-многим)'
              ],
              settings: [
                { name: 'linkedTableId', desc: 'ID связанной таблицы' },
                { name: 'displayColumn', desc: 'Колонка для отображения' }
              ],
              example: 'Клиент: [→ Иванов Иван] (клик открывает карточку)'
            }}
          />
          <ColumnTypeAccordion
            type="table"
            name="📊 Встроенная таблица"
            description="Отображает записи из другой таблицы, отфильтрованные по текущей строке"
            details={{
              features: [
                'Показывает связанные записи прямо в ячейке',
                'Фильтрация по ключу текущей строки',
                'Выбор колонок для отображения',
                'Пагинация при большом количестве'
              ],
              settings: [
                { name: 'sourceTableId', desc: 'Таблица-источник' },
                { name: 'filterColumn', desc: 'Колонка для фильтрации' },
                { name: 'displayColumns', desc: 'Колонки для отображения' }
              ],
              example: 'Товар → [Подтовары: Размер S | Размер M | Размер L]'
            }}
          />
          <ColumnTypeAccordion
            type="rollup"
            name="📈 Сводка (Rollup)"
            description="Агрегация данных из связанной таблицы"
            details={{
              features: [
                '10 функций агрегации',
                '4 формата вывода: число, валюта, процент, компактный',
                'Автоматический пересчёт при изменении данных'
              ],
              settings: [
                { name: 'function', desc: 'sum | count | avg | min | max | percent | range | countAll | countValues | countUnique' },
                { name: 'format', desc: 'number | currency | percent | compact' }
              ],
              example: 'Сумма заказов: 125 400 ₽ или Кол-во: 47 шт.'
            }}
          />
          <ColumnTypeAccordion
            type="vector"
            name="✨ Вектор (AI поиск)"
            description="Векторные эмбеддинги для семантического поиска"
            details={{
              features: [
                'AI-эмбеддинги для поиска по смыслу',
                'Формула для составления текста',
                'Интеграция с OpenAI text-embedding-ada-002',
                'Хранение в PostgreSQL + pgvector'
              ],
              settings: [
                { name: 'formula', desc: 'Шаблон: {{title}} {{description}}' },
                { name: 'prefix', desc: 'Контекст перед текстом' },
                { name: 'suffix', desc: 'Контекст после текста' }
              ],
              example: 'Запрос: "синие джинсы" → Найдено: "Брюки деним navy" (95%)'
            }}
          />
          <ColumnTypeAccordion
            type="button"
            name="🔘 Кнопка"
            description="Кнопка для действий"
            details={{
              features: [
                '3 типа действий: открыть URL, webhook, автоматизация',
                'Поддержка переменных в URL',
                '3 стиля: primary, secondary, danger'
              ],
              settings: [
                { name: 'action', desc: 'url | webhook | automation' },
                { name: 'url', desc: 'URL с переменными: /edit/{{id}}' },
                { name: 'style', desc: 'primary | secondary | danger' }
              ],
              example: '[Редактировать] → /admin/edit/{{id}}'
            }}
          />
          <ColumnTypeAccordion
            type="audio"
            name="🎵 Аудио"
            description="Аудио плеер для воспроизведения звуков"
            details={{
              features: [
                'Встроенный аудио плеер в ячейке',
                'Поддержка URL на аудио файлы',
                'Формула для вычисления пути',
                'Префикс (домен CDN)'
              ],
              settings: [
                { name: 'formula', desc: 'Шаблон: audio/{{filename}}.mp3' },
                { name: 'prefix', desc: 'URL CDN: https://cdn.site.com/' }
              ],
              example: '[▶ 0:00 / 3:45] → воспроизведение из CDN'
            }}
          />
          <ColumnTypeAccordion
            type="password"
            name="🔐 Пароль"
            description="Зашифрованный текст"
            details={{
              features: [
                'Скрытое отображение: ••••••••',
                'Безопасное хранение',
                'Кнопка показать/скрыть',
                'Копирование в буфер'
              ],
              settings: [
                { name: 'showButton', desc: 'Показывать кнопку "глазик"' }
              ],
              example: 'Поле ввода: [••••••••] 👁️ 📋'
            }}
          />
          <ColumnTypeAccordion
            type="formula"
            name="∑ Формула"
            description="Вычисляемое поле"
            details={{
              features: [
                'JavaScript выражения',
                'Доступ к данным других колонок',
                'Автопересчёт при изменении',
                'Форматирование результата'
              ],
              settings: [
                { name: 'expression', desc: 'JS выражение: price * qty' },
                { name: 'format', desc: 'number | currency | percent' }
              ],
              example: 'Итого: price * qty * (1 - discount/100) → 8 500 ₽'
            }}
          />
          <ColumnTypeAccordion
            type="dialog"
            name="💬 AI Диалог"
            description="AI диалог / переписка"
            details={{
              features: [
                'История переписки с AI',
                'Контекст из текущей строки',
                'Интеграция с AI агентами',
                'Сохранение диалога в строке'
              ],
              settings: [
                { name: 'agentId', desc: 'ID AI агента для диалога' },
                { name: 'contextColumns', desc: 'Колонки для контекста' }
              ],
              example: 'Диалог с AI по карточке клиента'
            }}
          />
          <ColumnTypeAccordion
            type="chat"
            name="🤖 AI Чат"
            description="AI чат-разговор"
            details={{
              features: [
                'Полноценный чат с AI',
                'История сообщений',
                'Стриминг ответов',
                'Поддержка разных моделей'
              ],
              settings: [
                { name: 'model', desc: 'Модель: gpt-4, claude-3, etc.' },
                { name: 'systemPrompt', desc: 'Системный промпт' }
              ],
              example: 'Чат с ИИ-ассистентом в ячейке'
            }}
          />
        </div>
      </section>

      <VectorColumnDetails />
      <ColumnActionsSection />
      <DisplaySettingsSection />
      <FormulasSection />

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Настройки колонок</h2>
        <div className="grid grid-cols-2 gap-4">
          <SettingCard title="Название" description="Отображаемое имя колонки" />
          <SettingCard title="Тип" description="Определяет формат данных" />
          <SettingCard title="Обязательность" description="Требовать заполнение" />
          <SettingCard title="Значение по умолчанию" description="Автоматически подставляется" />
          <SettingCard title="Ширина" description="Размер колонки в таблице" />
          <SettingCard title="Видимость" description="Скрыть/показать колонку" />
        </div>
      </section>
    </div>
  );
}

function VectorColumnDetails() {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">✨ Векторная колонка (AI поиск)</h2>
      <div className="bg-gradient-to-r from-violet-500/10 to-primary-500/10 rounded-xl p-6 border border-violet-500/30">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl flex-shrink-0">
            ✨
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Что такое векторная колонка?</h3>
            <p className="text-[var(--text-secondary)]">
              Векторная колонка автоматически создаёт AI-эмбеддинги (векторные представления) из текстовых данных,
              что позволяет искать записи по смыслу, а не по точному совпадению слов.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">🎯 Применение</h4>
            <ul className="text-sm text-[var(--text-secondary)] space-y-1">
              <li>• Поиск похожих товаров</li>
              <li>• Семантический поиск документов</li>
              <li>• Рекомендации контента</li>
              <li>• Дублирование записей</li>
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">⚙️ Технология</h4>
            <ul className="text-sm text-[var(--text-secondary)] space-y-1">
              <li>• OpenAI text-embedding-ada-002</li>
              <li>• Хранение в PostgreSQL + pgvector</li>
              <li>• Косинусное сходство для поиска</li>
              <li>• Автоматическая векторизация</li>
            </ul>
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-primary)]">
          <h4 className="font-medium text-[var(--text-primary)] mb-3">📝 Настройки векторной колонки</h4>

          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded">formula</code>
                <span className="text-sm text-[var(--text-tertiary)]">необязательно</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                Формула для создания текста, который будет векторизован. Поддерживает переменные из других колонок.
              </p>
              <pre className="p-3 bg-[var(--bg-primary)] rounded text-xs text-emerald-400">
{`{{title}} {{articul}}
{{description}}
Категория: {{category_id}}
Бренд: {{brand_id}}`}
              </pre>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded">prefix</code>
                <span className="text-sm text-[var(--text-tertiary)]">необязательно</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Текст, добавляемый перед формулой. Используется для контекста.
              </p>
              <code className="text-xs bg-[var(--bg-primary)] text-emerald-400 px-2 py-1 rounded">"Товар: "</code>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs bg-violet-500/20 text-violet-400 px-2 py-0.5 rounded">suffix</code>
                <span className="text-sm text-[var(--text-tertiary)]">необязательно</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Текст, добавляемый после формулы.
              </p>
              <code className="text-xs bg-[var(--bg-primary)] text-emerald-400 px-2 py-1 rounded">" (в наличии)"</code>
            </div>
          </div>
        </div>

        <div className="mt-4 p-4 bg-primary-500/10 border border-primary-500/30 rounded-lg">
          <h4 className="font-medium text-[var(--text-primary)] mb-2">💡 Пример: Поиск товаров</h4>
          <p className="text-sm text-[var(--text-secondary)] mb-3">
            Пользователь ищет "синие джинсы мужские". Система найдёт товары с похожим смыслом,
            даже если слова отличаются: "Брюки деним navy для мужчин".
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded">Запрос</span>
            <code className="text-[var(--text-secondary)]">синие джинсы мужские</code>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span className="px-2 py-1 bg-primary-500/20 text-primary-400 rounded">Результат</span>
            <code className="text-[var(--text-secondary)]">Брюки деним navy (95% сходство)</code>
          </div>
        </div>
      </div>
    </section>
  );
}

function ColumnActionsSection() {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚙️ Действия с колонками</h2>
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <h3 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <span className="text-xl">➕</span>
            Создание колонки
          </h3>
          <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>1. Клик по кнопке <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Добавить колонку</kbd> в заголовке таблицы</li>
            <li>2. Выберите тип колонки из списка (text, number, select и т.д.)</li>
            <li>3. Укажите название и системное имя (автоматически генерируется из названия)</li>
            <li>4. Настройте параметры в зависимости от типа</li>
            <li>5. Нажмите <kbd className="px-2 py-0.5 bg-primary-500/20 text-primary-400 rounded text-xs">Сохранить</kbd></li>
          </ol>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">✏️</span>
              Редактирование
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Клик по иконке шестерёнки ⚙️ в заголовке колонки или правая кнопка мыши → Настройки
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">🗑️</span>
              Удаление
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Настройки колонки → внизу кнопка <span className="text-red-400">Удалить колонку</span>. Данные будут потеряны!
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">↔️</span>
              Перемещение
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Перетащите заголовок колонки влево/вправо для изменения порядка отображения
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">👁️</span>
              Скрытие/Показ
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Правая кнопка на заголовке → Скрыть колонку. Восстановить через меню "Скрытые колонки"
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">📋</span>
              Дублирование
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Настройки колонки → Дублировать. Создаёт копию со всеми настройками
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <span className="text-lg">📏</span>
              Изменение ширины
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Перетащите границу между заголовками колонок или укажите точное значение в пикселях
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DisplaySettingsSection() {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🎨 Настройки отображения</h2>
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Ширина колонки</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Размер в пикселях (80-800px)</p>
            </div>
            <code className="text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded text-primary-400">width</code>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-primary-500/10 text-primary-400 rounded">Авто</span>
            <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded">150px (по умолчанию)</span>
            <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded">200px, 300px...</span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Выравнивание текста</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Горизонтальное выравнивание содержимого</p>
            </div>
            <code className="text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded text-primary-400">align</code>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-primary-500/10 text-primary-400 rounded">◀️ Слева</span>
            <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded">◆ По центру</span>
            <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded">▶️ Справа</span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Перенос текста</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Поведение при переполнении ячейки</p>
            </div>
            <code className="text-xs bg-[var(--bg-tertiary)] px-2 py-1 rounded text-primary-400">wrap</code>
          </div>
          <div className="space-y-2 text-sm">
            <div className="p-2 rounded bg-[var(--bg-tertiary)]">
              <strong className="text-[var(--text-primary)]">nowrap</strong>
              <span className="text-[var(--text-tertiary)]"> — </span>
              <span className="text-[var(--text-secondary)]">Одна строка с обрезкой ...</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-tertiary)]">
              <strong className="text-[var(--text-primary)]">wrap</strong>
              <span className="text-[var(--text-tertiary)]"  > — </span>
              <span className="text-[var(--text-secondary)]">Автоматический перенос, высота по содержимому</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-tertiary)]">
              <strong className="text-[var(--text-primary)]">ellipsis</strong>
              <span className="text-[var(--text-tertiary)]"  > — </span>
              <span className="text-[var(--text-secondary)]">Ограниченный перенос (2-3 строки) + ...</span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Типографика</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Размер шрифта и начертание</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded">📏 Размер: 10-24px</span>
            <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded"><strong>Жирный</strong></span>
            <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded"><em>Курсив</em></span>
            <span className="px-2 py-1 bg-[var(--bg-tertiary)] rounded"><code>Моноширинный</code></span>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">Цвета</h4>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Цвет текста и фона ячейки</p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 p-2 rounded" style={{backgroundColor: 'rgb(239, 246, 255)', color: 'rgb(30, 64, 175)'}}>
              <span className="text-xs">🎨 Цвет текста</span>
            </div>
            <div className="flex-1 p-2 rounded" style={{backgroundColor: 'rgb(254, 249, 195)', color: 'rgb(161, 98, 7)'}}>
              <span className="text-xs">🎨 Цвет фона</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

