import type { CalendarSettingsProps } from './types';

export function CalendarWidgetSettings({
  textColumns,
  dateColumns,
  allDisplayableColumns,
  selectColumns,
  loadingColumns,
  creatingColumn,
  handleCreatePresetColumn,
  dateColumn,
  setDateColumn,
  calendarEndDateColumn,
  setCalendarEndDateColumn,
  calendarTitleColumn,
  setCalendarTitleColumn,
  calendarDescriptionColumn,
  setCalendarDescriptionColumn,
  calendarColorColumn,
  setCalendarColorColumn,
}: CalendarSettingsProps) {
  return (
    <>
      {/* Title Column */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка заголовка события *
        </label>
        <select
          value={calendarTitleColumn}
          onChange={(e) => setCalendarTitleColumn(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns}
        >
          <option value="">Выберите колонку</option>
          {textColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
        </select>
      </div>

      {/* Date columns row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Дата начала *
          </label>
          <select
            value={dateColumn}
            onChange={(e) => setDateColumn(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            disabled={loadingColumns}
          >
            <option value="">Выберите колонку</option>
            {dateColumns.map((col) => (
              <option key={col.id} value={col.name}>
                {col.displayName || col.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Дата окончания
          </label>
          <select
            value={calendarEndDateColumn}
            onChange={(e) => setCalendarEndDateColumn(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            disabled={loadingColumns}
          >
            <option value="">Не выбрано</option>
            {dateColumns.map((col) => (
              <option key={col.id} value={col.name}>
                {col.displayName || col.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Для многодневных событий
          </p>
        </div>
      </div>

      {/* Description Column */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка описания
        </label>
        <select
          value={calendarDescriptionColumn}
          onChange={(e) => setCalendarDescriptionColumn(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns}
        >
          <option value="">Не выбрано</option>
          {allDisplayableColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Показывается в подсказке при наведении
        </p>
      </div>

      {/* Color Column */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка цвета
        </label>
        <select
          value={calendarColorColumn}
          onChange={(e) => {
            if (e.target.value === '__create_color__') {
              handleCreatePresetColumn('color');
            } else {
              setCalendarColorColumn(e.target.value);
            }
          }}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns || creatingColumn}
        >
          <option value="">Не выбрано (авто-цвета)</option>
          {selectColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
          <option value="__create_color__" className="text-[var(--color-primary-500)]">
            + Создать колонку "Цвет"
          </option>
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Цветовая метка событий
        </p>
      </div>
    </>
  );
}
