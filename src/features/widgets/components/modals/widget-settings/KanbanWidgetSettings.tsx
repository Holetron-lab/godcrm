import { Trash2 } from 'lucide-react';
import type { KanbanSettingsProps } from './types';

export function KanbanWidgetSettings({
  selectColumns,
  textColumns,
  dateColumns,
  allDisplayableColumns,
  safeColumns,
  loadingColumns,
  creatingColumn,
  handleCreatePresetColumn,
  statusColumn,
  setStatusColumn,
  titleColumn,
  setTitleColumn,
  descriptionColumn,
  setDescriptionColumn,
  assigneeColumn,
  setAssigneeColumn,
  scheduledDateColumn,
  setScheduledDateColumn,
  dueDateColumn,
  setDueDateColumn,
  colorColumn,
  setColorColumn,
  cardColumns,
  setCardColumns,
  visibleColumns,
  setVisibleColumns,
  availableCardColumns,
  availableExpandedColumns,
}: KanbanSettingsProps) {
  return (
    <>
      {/* Status Column - required */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка статуса (для колонок канбан) *
        </label>
        <select
          value={statusColumn}
          onChange={(e) => {
            if (e.target.value === '__create_status__') {
              handleCreatePresetColumn('status');
            } else {
              setStatusColumn(e.target.value);
            }
          }}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns || creatingColumn}
        >
          <option value="">Выберите колонку</option>
          {selectColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
          <option value="__create_status__">
            + Создать колонку "Статус"
          </option>
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Колонка типа select с опциями для колонок канбан
        </p>
      </div>

      {/* Title Column - required */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка заголовка карточки *
        </label>
        <select
          value={titleColumn}
          onChange={(e) => setTitleColumn(e.target.value)}
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

      {/* Description Column - optional */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка описания
        </label>
        <select
          value={descriptionColumn}
          onChange={(e) => setDescriptionColumn(e.target.value)}
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
          Текст под заголовком карточки
        </p>
      </div>

      {/* Assignee Column - optional */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка исполнителя
        </label>
        <select
          value={assigneeColumn}
          onChange={(e) => setAssigneeColumn(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          disabled={loadingColumns}
        >
          <option value="">Не выбрано</option>
          {safeColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.displayName || col.name}
            </option>
          ))}
        </select>
      </div>

      {/* Scheduled Date Column - optional */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Срок от
          </label>
          <select
            value={scheduledDateColumn}
            onChange={(e) => setScheduledDateColumn(e.target.value)}
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
        </div>

        {/* Due Date Column - optional */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Срок до
          </label>
          <select
            value={dueDateColumn}
            onChange={(e) => setDueDateColumn(e.target.value)}
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
        </div>
      </div>

      {/* Color Column - optional */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Колонка цвета
        </label>
        <select
          value={colorColumn}
          onChange={(e) => {
            if (e.target.value === '__create_color__') {
              handleCreatePresetColumn('color');
            } else {
              setColorColumn(e.target.value);
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
          <option value="__create_color__" className="text-[var(--color-primary-500)]">
            + Создать колонку "Цвет"
          </option>
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Колонка для цветовой метки карточки
        </p>
      </div>

      {/* Columns visible on card preview (above the line) */}
      <div className="border-t border-[var(--border-primary)] pt-4 mt-4">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Колонки на карточке
        </label>

        {cardColumns.length > 0 && (
          <div className="space-y-2 mb-3">
            {cardColumns.map((colName, idx) => {
              const col = safeColumns.find(c => c.name === colName);
              return (
                <div key={colName} className="flex items-center gap-2 bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm text-[var(--text-primary)]">
                    {col?.displayName || col?.name || colName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCardColumns(cardColumns.filter((_, i) => i !== idx))}
                    className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-red-500 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {availableCardColumns.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setCardColumns([...cardColumns, e.target.value]);
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          >
            <option value="">+ Добавить колонку...</option>
            {availableCardColumns.map((col) => (
              <option key={col.id} value={col.name}>
                {col.displayName || col.name}
              </option>
            ))}
          </select>
        )}

        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Эти колонки всегда видны на превью карточки
        </p>
      </div>

      {/* Divider */}
      <div className="relative border-t border-dashed border-[var(--border-primary)] my-4">
        <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-tertiary)]">
          при развороте
        </span>
      </div>

      {/* Columns visible on expand (below the line) */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Дополнительные колонки
        </label>

        {visibleColumns.length > 0 && (
          <div className="space-y-2 mb-3">
            {visibleColumns.map((colName, idx) => {
              const col = safeColumns.find(c => c.name === colName);
              return (
                <div key={colName} className="flex items-center gap-2 bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm text-[var(--text-primary)]">
                    {col?.displayName || col?.name || colName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(visibleColumns.filter((_, i) => i !== idx))}
                    className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-red-500 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {availableExpandedColumns.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setVisibleColumns([...visibleColumns, e.target.value]);
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          >
            <option value="">+ Добавить колонку...</option>
            {availableExpandedColumns.map((col) => (
              <option key={col.id} value={col.name}>
                {col.displayName || col.name}
              </option>
            ))}
          </select>
        )}

        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Показываются только при разворачивании карточки
        </p>
      </div>
    </>
  );
}
