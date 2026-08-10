import type { ColumnModel } from '@/features/tables/types/table.types';
import { useLockedFields, LOCKED_TOOLTIP_RU } from '../../../utils/lockedFieldsContext';
import { LockedFieldBadge } from '../../LockedFieldBadge';

export interface TaskListSettingsProps {
  textColumns: ColumnModel[];
  dateColumns: ColumnModel[];
  selectColumns: ColumnModel[];
  allDisplayableColumns: ColumnModel[];
  loadingColumns: boolean;
  titleColumn: string;
  setTitleColumn: (v: string) => void;
  descriptionColumn: string;
  setDescriptionColumn: (v: string) => void;
  taskCompletedColumn: string;
  setTaskCompletedColumn: (v: string) => void;
  scheduledDateColumn: string;
  setScheduledDateColumn: (v: string) => void;
  dueDateColumn: string;
  setDueDateColumn: (v: string) => void;
  colorColumn: string;
  setColorColumn: (v: string) => void;
  bddMode: boolean;
  setBddMode: (v: boolean) => void;
  bddStatusColumn: string;
  setBddStatusColumn: (v: string) => void;
  bddPriorityColumn: string;
  setBddPriorityColumn: (v: string) => void;
  bddCodeColumn: string;
  setBddCodeColumn: (v: string) => void;
}

export function TaskListWidgetSettings({
  textColumns,
  dateColumns,
  selectColumns,
  allDisplayableColumns,
  loadingColumns,
  titleColumn,
  setTitleColumn,
  descriptionColumn,
  setDescriptionColumn,
  taskCompletedColumn,
  setTaskCompletedColumn,
  scheduledDateColumn,
  setScheduledDateColumn,
  dueDateColumn,
  setDueDateColumn,
  colorColumn,
  setColorColumn,
  bddMode,
  setBddMode,
  bddStatusColumn,
  setBddStatusColumn,
  bddPriorityColumn,
  setBddPriorityColumn,
  bddCodeColumn,
  setBddCodeColumn,
}: TaskListSettingsProps) {
  // ADR-0005 C-4 — fields the document author has pinned via atom-level
  // settings_override are non-editable in this rail. Outside a widget-atom
  // (e.g. global widget settings) the provider is absent and isLocked()
  // returns false for every path.
  const { isLocked } = useLockedFields();
  const bddModeLocked = isLocked('bdd_mode');
  const titleColumnLocked = isLocked('card_title_column') || isLocked('titleColumn');
  const descriptionColumnLocked = isLocked('card_subtitle_column') || isLocked('descriptionColumn');
  const completedColumnLocked = isLocked('completed_column') || isLocked('status_column');
  const scheduledLocked = isLocked('kanban.scheduledDateColumn');
  const dueLocked = isLocked('kanban.dueDateColumn');
  const colorLocked = isLocked('kanban.colorColumn');
  const bddStatusLocked = isLocked('bdd_status_column');
  const bddPriorityLocked = isLocked('bdd_priority_column');
  const bddCodeLocked = isLocked('bdd_code_column');

  return (
    <>
      {/* BDD mode toggle */}
      <div className="border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
        <label
          title={bddModeLocked ? LOCKED_TOOLTIP_RU : undefined}
          className={`flex items-center gap-3 cursor-pointer ${bddModeLocked ? 'opacity-60 cursor-default' : ''}`}
        >
          <input
            type="checkbox"
            checked={bddMode}
            onChange={(e) => setBddMode(e.target.checked)}
            disabled={bddModeLocked}
            className="w-4 h-4 accent-[var(--color-primary-500)] disabled:opacity-60"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              BDD-режим
              {bddModeLocked && <LockedFieldBadge />}
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Отображать виджет как список BDD-критериев: статус-иконки, priority-chip (must/should/could/wont), фильтры locked/unlocked/regressed.
            </p>
          </div>
        </label>
      </div>

      {bddMode ? (
        <>
          {/* BDD column mapping */}
          <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Маппинг BDD-колонок</p>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Колонка статуса *{bddStatusLocked && <LockedFieldBadge />}
              </label>
              <select
                value={bddStatusColumn}
                onChange={(e) => setBddStatusColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || bddStatusLocked}
                title={bddStatusLocked ? LOCKED_TOOLTIP_RU : undefined}
              >
                <option value="">Выберите колонку</option>
                {allDisplayableColumns.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.displayName || col.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                verified / pending / regressed / agent_claimed / human_confirmed
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Колонка приоритета (MoSCoW){bddPriorityLocked && <LockedFieldBadge />}
              </label>
              <select
                value={bddPriorityColumn}
                onChange={(e) => setBddPriorityColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || bddPriorityLocked}
                title={bddPriorityLocked ? LOCKED_TOOLTIP_RU : undefined}
              >
                <option value="">Не выбрано</option>
                {allDisplayableColumns.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.displayName || col.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                must / should / could / wont
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Колонка кода{bddCodeLocked && <LockedFieldBadge />}
              </label>
              <select
                value={bddCodeColumn}
                onChange={(e) => setBddCodeColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || bddCodeLocked}
                title={bddCodeLocked ? LOCKED_TOOLTIP_RU : undefined}
              >
                <option value="">Не выбрано</option>
                {allDisplayableColumns.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.displayName || col.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Короткий ID критерия (C-1, AC-02, …)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Колонка заголовка{titleColumnLocked && <LockedFieldBadge />}
              </label>
              <select
                value={titleColumn}
                onChange={(e) => setTitleColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || titleColumnLocked}
                title={titleColumnLocked ? LOCKED_TOOLTIP_RU : undefined}
              >
                <option value="">Не выбрано</option>
                {allDisplayableColumns.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.displayName || col.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Task List (non-BDD) column mapping */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Колонка заголовка *{titleColumnLocked && <LockedFieldBadge />}
            </label>
            <select
              value={titleColumn}
              onChange={(e) => setTitleColumn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
              disabled={loadingColumns || titleColumnLocked}
              title={titleColumnLocked ? LOCKED_TOOLTIP_RU : undefined}
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
              Колонка описания{descriptionColumnLocked && <LockedFieldBadge />}
            </label>
            <select
              value={descriptionColumn}
              onChange={(e) => setDescriptionColumn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
              disabled={loadingColumns || descriptionColumnLocked}
              title={descriptionColumnLocked ? LOCKED_TOOLTIP_RU : undefined}
            >
              <option value="">Не выбрано</option>
              {allDisplayableColumns.map((col) => (
                <option key={col.id} value={col.name}>
                  {col.displayName || col.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Колонка статуса выполнения{completedColumnLocked && <LockedFieldBadge />}
            </label>
            <select
              value={taskCompletedColumn}
              onChange={(e) => setTaskCompletedColumn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
              disabled={loadingColumns || completedColumnLocked}
              title={completedColumnLocked ? LOCKED_TOOLTIP_RU : undefined}
            >
              <option value="">Не выбрано</option>
              {allDisplayableColumns.map((col) => (
                <option key={col.id} value={col.name}>
                  {col.displayName || col.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Boolean (выполнено) или select со значением "done"/"completed"
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Срок от{scheduledLocked && <LockedFieldBadge />}
              </label>
              <select
                value={scheduledDateColumn}
                onChange={(e) => setScheduledDateColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || scheduledLocked}
                title={scheduledLocked ? LOCKED_TOOLTIP_RU : undefined}
              >
                <option value="">Не выбрано</option>
                {dateColumns.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.displayName || col.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Срок до{dueLocked && <LockedFieldBadge />}
              </label>
              <select
                value={dueDateColumn}
                onChange={(e) => setDueDateColumn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
                disabled={loadingColumns || dueLocked}
                title={dueLocked ? LOCKED_TOOLTIP_RU : undefined}
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

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Колонка цвета{colorLocked && <LockedFieldBadge />}
            </label>
            <select
              value={colorColumn}
              onChange={(e) => setColorColumn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
              disabled={loadingColumns || colorLocked}
              title={colorLocked ? LOCKED_TOOLTIP_RU : undefined}
            >
              <option value="">Не выбрано</option>
              {selectColumns.map((col) => (
                <option key={col.id} value={col.name}>
                  {col.displayName || col.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
