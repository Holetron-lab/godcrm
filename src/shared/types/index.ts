// Electron Desktop API types
export * from './electron.types';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: ApiError;
}

export type ColumnType =
  | 'text'
  | 'number'
  | 'email'
  | 'url'
  | 'phone'
  | 'date'      // Calendar date without time
  | 'datetime'  // Date and time (specific date)
  | 'time'      // Time-only (HH:MM) with optional day-of-month for schedules, cron format support
  | 'checkbox'
  | 'select'
  | 'multi-select'
  | 'relation'  // Link to rows in another table (with navigation to edit)
  | 'person'
  | 'file'
  | 'password'
  | 'formula'
  | 'table'    // Embedded table with filter (e.g. show sub-items filtered by parent_id)
  | 'rollup'
  | 'button'
  | 'image'
  | 'audio'    // Audio player with URL
  | 'vector'   // Vector embedding for AI search
  | 'color'    // ADR-028: Color picker with emoji/palette/CMYK/RAL/Pantone modes
  | 'verification' // ADR-0011: Multi-factor ownership verification
  | 'json'     // ADR-0017: JSON viewer/editor (object or stringified payload)
  | 'long_text' // ADR-0041: long text with JSON auto-detect renderer
  | 'order'    // ADR-151: typed sort position (P0 integer, ascending; P1 fractional indexing)
  | 'actor'    // ADR-151: typed provenance { source, actor_ref, at } — supersedes ADR-0009 created_by convention
  | 'geo_point' // ADR-0035 Slice 1: point on the map { lat, lng, …meta }, parsed by shared/geo-point.js only
  | 'address';  // ADR-0035-A: postal address { formatted, name?, …components } without coordinates, optionally linked to a geo_point column

/**
 * ADR-151: allowed values for an `actor` cell's `source` field.
 * `ai` is kept distinct from `api` (decision logged 2026-06-03) so the
 * agent write-path is queryable separately from generic API writes.
 */
export const ACTOR_SOURCES = ['manual', 'import', 'api', 'workflow', 'system', 'ai'] as const;
export type ActorSource = (typeof ACTOR_SOURCES)[number];

/** ADR-151: shape of an `actor`-typed cell value. */
export interface ActorValue {
  source: ActorSource;
  actor_ref?: number | string | null; // reuses the `person` resolver (user id)
  at?: string; // ISO-8601 timestamp
}

/**
 * Metadata for column types - labels, descriptions and icons
 * Used in UI for creating/editing columns
 * This is the SINGLE SOURCE OF TRUTH for all column type definitions
 */
export const COLUMN_TYPE_METADATA: Record<ColumnType, { 
  label: string; 
  labelEn: string; 
  emoji: string;
  description: string;
  descriptionEn: string;
}> = {
  text: { label: 'Текст', labelEn: 'Text', emoji: '📝', description: 'Обычный текст', descriptionEn: 'Plain text' },
  long_text: { label: 'Длинный текст', labelEn: 'Long text', emoji: '📄', description: 'Длинный текст с авто-детектом JSON', descriptionEn: 'Long text with JSON auto-detect' },
  number: { label: 'Число', labelEn: 'Number', emoji: '🔢', description: 'Числовые значения', descriptionEn: 'Numeric values' },
  email: { label: 'Email', labelEn: 'Email', emoji: '✉️', description: 'Email адрес', descriptionEn: 'Email address' },
  url: { label: 'Ссылка', labelEn: 'URL', emoji: '🔗', description: 'URL адрес', descriptionEn: 'URL address' },
  phone: { label: 'Телефон', labelEn: 'Phone', emoji: '📞', description: 'Номер телефона', descriptionEn: 'Phone number' },
  date: { label: 'Дата', labelEn: 'Date', emoji: '📅', description: 'Дата без времени', descriptionEn: 'Date without time' },
  datetime: { label: 'Дата и время', labelEn: 'Date & Time', emoji: '📅', description: 'Дата, дата+время, месяц, год, неделя, квартал', descriptionEn: 'Date, date+time, month, year, week, quarter' },
  time: { label: 'Время (крон)', labelEn: 'Time (cron)', emoji: '⏰', description: 'Расписание (HH:MM, день месяца)', descriptionEn: 'Schedule (HH:MM, day of month)' },
  checkbox: { label: 'Чекбокс', labelEn: 'Checkbox', emoji: '☑️', description: 'Да/Нет', descriptionEn: 'Yes/No' },
  select: { label: 'Выбор (select)', labelEn: 'Select', emoji: '🎯', description: 'Один из списка', descriptionEn: 'One from list' },
  'multi-select': { label: 'Множественный выбор', labelEn: 'Multi-select', emoji: '🧩', description: 'Несколько из списка', descriptionEn: 'Multiple from list' },
  relation: { label: 'Связь', labelEn: 'Relation', emoji: '🔗', description: 'Ссылка на строки другой таблицы', descriptionEn: 'Link to rows in another table' },
  person: { label: 'Пользователь', labelEn: 'Person', emoji: '👤', description: 'Ссылка на пользователя', descriptionEn: 'Link to user' },
  file: { label: 'Файл', labelEn: 'File', emoji: '📎', description: 'Прикрепленный файл', descriptionEn: 'Attached file' },
  password: { label: 'Пароль', labelEn: 'Password', emoji: '🔐', description: 'Зашифрованный текст', descriptionEn: 'Encrypted text' },
  formula: { label: 'Формула', labelEn: 'Formula', emoji: '∑', description: 'Вычисляемое поле', descriptionEn: 'Calculated field' },
  table: { label: 'Таблица', labelEn: 'Table', emoji: '📋', description: 'Встроенная таблица (подтовары)', descriptionEn: 'Embedded table (sub-items)' },
  rollup: { label: 'Сводка', labelEn: 'Rollup', emoji: '📊', description: 'Агрегация данных', descriptionEn: 'Data aggregation' },
  button: { label: 'Кнопка', labelEn: 'Button', emoji: '🔘', description: 'Кнопка действия', descriptionEn: 'Action button' },
  image: { label: 'Изображение', labelEn: 'Image', emoji: '🖼️', description: 'Картинка', descriptionEn: 'Image' },
  audio: { label: 'Аудио', labelEn: 'Audio', emoji: '🎵', description: 'Аудио плеер', descriptionEn: 'Audio player' },
  vector: { label: 'Вектор', labelEn: 'Vector', emoji: '🧠', description: 'AI эмбеддинг для поиска', descriptionEn: 'AI embedding for search' },
  color: { label: 'Цвет', labelEn: 'Color', emoji: '🎨', description: 'Цвет (HEX/CMYK/RAL) или emoji', descriptionEn: 'Color (HEX/CMYK/RAL) or emoji picker' },
  verification: { label: 'Верификация', labelEn: 'Verification', emoji: '🛡️', description: 'Подтверждение владения (ADR-0011)', descriptionEn: 'Multi-factor ownership verification (ADR-0011)' },
  json: { label: 'JSON', labelEn: 'JSON', emoji: '🧬', description: 'JSON-объект или строка', descriptionEn: 'JSON object or string' },
  order: { label: 'Порядок', labelEn: 'Order', emoji: '↕️', description: 'Позиция для ручной сортировки (ADR-151)', descriptionEn: 'Manual sort position (ADR-151)' },
  actor: { label: 'Автор', labelEn: 'Actor', emoji: '🪪', description: 'Источник записи: кто/чем создано (ADR-151)', descriptionEn: 'Provenance: who/what created the row (ADR-151)' },
  // «Гео»: the two geo types sit next to each other in the (flat) picker.
  geo_point: { label: 'Геоточка', labelEn: 'Geo point', emoji: '📍', description: 'Координаты lat, lng (ADR-0035)', descriptionEn: 'Coordinates lat, lng (ADR-0035)' },
  address: { label: 'Адрес', labelEn: 'Address', emoji: '📮', description: 'Почтовый адрес, можно связать с Геоточкой (ADR-0035-A)', descriptionEn: 'Postal address, optionally linked to a Geo point (ADR-0035-A)' }
};

/**
 * Column types that should be hidden from UI selectors
 * These types are deprecated or handled via config (e.g., relation is config on select/multi-select)
 */
const HIDDEN_COLUMN_TYPES: ColumnType[] = ['relation', 'date', 'rollup'];

/**
 * Helper function to get column type options for Select components
 */
export function getColumnTypeOptions(language: 'ru' | 'en' = 'ru'): Array<{ value: ColumnType; label: string }> {
  return Object.entries(COLUMN_TYPE_METADATA)
    .filter(([value]) => !HIDDEN_COLUMN_TYPES.includes(value as ColumnType))
    .map(([value, meta]) => ({
      value: value as ColumnType,
      label: language === 'en' ? meta.labelEn : meta.label
    }));
}

/**
 * Helper function to get column type options with emoji for visual selectors
 */
export function getColumnTypeOptionsWithEmoji(language: 'ru' | 'en' = 'ru'): Array<{ 
  value: ColumnType; 
  label: string; 
  emoji: string;
  description: string;
}> {
  return Object.entries(COLUMN_TYPE_METADATA)
    .filter(([value]) => !HIDDEN_COLUMN_TYPES.includes(value as ColumnType))
    .map(([value, meta]) => ({
      value: value as ColumnType,
      label: language === 'en' ? meta.labelEn : meta.label,
      emoji: meta.emoji,
      description: language === 'en' ? meta.descriptionEn : meta.description
    }));
}

/**
 * Helper function to get column type options with icon for CSV import
 */
export function getColumnTypeOptionsForCSV(language: 'ru' | 'en' = 'ru'): Array<{ 
  value: ColumnType; 
  label: string; 
  icon: string;
}> {
  return Object.entries(COLUMN_TYPE_METADATA)
    .filter(([value]) => !HIDDEN_COLUMN_TYPES.includes(value as ColumnType))
    .map(([value, meta]) => ({
      value: value as ColumnType,
      label: language === 'en' ? meta.labelEn : meta.label,
      icon: meta.emoji
    }));
}
