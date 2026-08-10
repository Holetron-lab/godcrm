import type { TimelineSettingsProps } from './types';

export function TimelineWidgetSettings({
  safeColumns,
  selectColumns,
  textColumns,
  dateColumns,
  loadingColumns,
  creatingColumn,
  handleCreatePresetColumn,
  startDateColumn,
  setStartDateColumn,
  endDateColumn,
  setEndDateColumn,
  timelineTitleColumn,
  setTimelineTitleColumn,
  timelineDescriptionColumn,
  setTimelineDescriptionColumn,
  timelineDependsOnColumn,
  setTimelineDependsOnColumn,
  timelineGroupByColumn,
  setTimelineGroupByColumn,
  timelineCalendarProjectId,
  setTimelineCalendarProjectId,
  timelineCalendarTableId,
  setTimelineCalendarTableId,
  timelineCalendarDateColumn,
  setTimelineCalendarDateColumn,
  timelineCalendarTypeColumn,
  setTimelineCalendarTypeColumn,
  timelineCalendarTagsColumn,
  setTimelineCalendarTagsColumn,
  timelineCalendarNoteColumn,
  setTimelineCalendarNoteColumn,
  timelineCalendarBgColorColumn,
  setTimelineCalendarBgColorColumn,
  timelineCalendarFontColorColumn,
  setTimelineCalendarFontColorColumn,
  creatingCalendarTable,
  handleCreateCalendarTable,
  spaceProjects,
  calendarProjectTables,
  systemDataProject,
}: TimelineSettingsProps) {
  return (
    <>
      {/* Start and End date columns in one row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Колонка начала
          </label>
          <select
            value={startDateColumn}
            onChange={(e) => setStartDateColumn(e.target.value)}
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
            Колонка окончания
          </label>
          <select
            value={endDateColumn}
            onChange={(e) => setEndDateColumn(e.target.value)}
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
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка заголовка
        </label>
        <select
          value={timelineTitleColumn}
          onChange={(e) => setTimelineTitleColumn(e.target.value)}
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

      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка описания
        </label>
        <select
          value={timelineDescriptionColumn}
          onChange={(e) => setTimelineDescriptionColumn(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns}
        >
          <option value="">Не выбрано</option>
          {textColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Показывается на карточке с многоточием
        </p>
      </div>

      {/* Gantt Dependencies */}
      <div className="pt-4 border-t border-[var(--border-primary)]">
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          Gantt настройки
          <span className="text-xs text-[var(--text-tertiary)] font-normal">(опционально)</span>
        </h4>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Колонка зависимостей
            </label>
            <select
              value={timelineDependsOnColumn}
              onChange={(e) => {
                if (e.target.value === '__create_dependency__') {
                  handleCreatePresetColumn('dependency');
                } else {
                  setTimelineDependsOnColumn(e.target.value);
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
              disabled={loadingColumns || creatingColumn}
            >
              <option value="">Не выбрано</option>
              {safeColumns.filter(c => ['text', 'multiselect', 'select', 'relation'].includes(c.type)).map((col) => (
                <option key={col.id} value={col.name}>
                  {col.displayName || col.name}
                </option>
              ))}
              <option value="__create_dependency__">
                Создать колонку "Зависимости"
              </option>
            </select>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Для связей между задачами (стрелки в режиме Gantt)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Колонка группировки (поток)
            </label>
            <select
              value={timelineGroupByColumn}
              onChange={(e) => {
                if (e.target.value === '__create_flow__') {
                  handleCreatePresetColumn('flow');
                } else {
                  setTimelineGroupByColumn(e.target.value);
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
              disabled={loadingColumns || creatingColumn}
            >
              <option value="">Не выбрано</option>
              {selectColumns.map((col) => (
                <option key={col.id} value={col.name}>
                  {col.displayName || col.name}
                </option>
              ))}
              <option value="__create_flow__">
                Создать колонку "Поток"
              </option>
            </select>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Для группировки задач по строкам (swimlanes)
            </p>
          </div>
        </div>
      </div>

      {/* Calendar Table Configuration */}
      <div className="pt-4 border-t border-[var(--border-primary)]">
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          Календарь (праздники/выходные)
          <span className="text-xs text-[var(--text-tertiary)] font-normal">(опционально)</span>
        </h4>

        <div className="space-y-3">
          {/* Project selection - auto-select System Data */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Проект
            </label>
            <select
              value={timelineCalendarProjectId || (systemDataProject ? String(systemDataProject.id) : '')}
              onChange={(e) => {
                setTimelineCalendarProjectId(e.target.value);
                setTimelineCalendarTableId(''); // Reset table when project changes
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            >
              <option value="">Выберите проект</option>
              {spaceProjects.map((project) => (
                <option key={String(project.id)} value={String(project.id)}>
                  {project.icon} {project.name} {project.type === 'system_data' ? '(System)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Table selection with create option */}
          {(timelineCalendarProjectId || systemDataProject) && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Таблица календаря
              </label>
              <select
                value={timelineCalendarTableId}
                onChange={(e) => {
                  if (e.target.value === '__create_calendar__') {
                    handleCreateCalendarTable();
                  } else {
                    setTimelineCalendarTableId(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                disabled={creatingCalendarTable}
              >
                <option value="">Выберите таблицу</option>
                {calendarProjectTables.map((table) => (
                  <option key={String(table.id)} value={String(table.id)}>
                    {table.icon} {table.name}
                  </option>
                ))}
                <option value="__create_calendar__">
                  {creatingCalendarTable ? 'Создание...' : 'Создать таблицу календаря'}
                </option>
              </select>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Создаст календарь: прошлый год + текущий + следующий
              </p>
            </div>
          )}

          {timelineCalendarTableId && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Колонка даты
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarDateColumn}
                    onChange={(e) => setTimelineCalendarDateColumn(e.target.value)}
                    placeholder="date"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Колонка типа дня
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarTypeColumn}
                    onChange={(e) => setTimelineCalendarTypeColumn(e.target.value)}
                    placeholder="day_type"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Колонка тегов
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarTagsColumn}
                    onChange={(e) => setTimelineCalendarTagsColumn(e.target.value)}
                    placeholder="tags"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Колонка примечания
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarNoteColumn}
                    onChange={(e) => setTimelineCalendarNoteColumn(e.target.value)}
                    placeholder="note"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Цвет столбца
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarBgColorColumn}
                    onChange={(e) => setTimelineCalendarBgColorColumn(e.target.value)}
                    placeholder="bg_color"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    Цвет шрифта
                  </label>
                  <input
                    type="text"
                    value={timelineCalendarFontColorColumn}
                    onChange={(e) => setTimelineCalendarFontColorColumn(e.target.value)}
                    placeholder="font_color"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
                  />
                </div>
              </div>

              <div className="bg-[var(--bg-tertiary)] rounded-lg p-3">
                <p className="text-xs text-[var(--text-tertiary)]">
                  <strong>Формат таблицы календаря:</strong><br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">date</code> - дата (Date)<br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">day_type</code> - тип: &quot;workday&quot;, &quot;weekend&quot;, &quot;holiday&quot;<br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">bg_color</code> - цвет фона столбца (Color)<br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">font_color</code> - цвет шрифта (Color)<br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">tags</code> - теги (multiselect)<br/>
                  <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded">note</code> - примечание (text)
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
