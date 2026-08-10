/**
 * ADR-0003 widget-embed §Phase1. Shown in the right panel when the selected doc
 * item is a widget. Displays the referenced widget + source, lets the user swap
 * the widget via the same picker modal, and holds a per-item filter override
 * (`settings_override.filter`: column + value; optional use-document-number flag).
 */

import { useState, useEffect, useMemo } from 'react';
import { Plus, RefreshCcw, Database, Loader2, Trash2, Settings2, CheckCircle2, Filter } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { useWidget, useUpdateWidget } from '../../../../hooks/useWidgets';
import { useTableById } from '@/features/tables/hooks/useTableById';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { EditWidgetSettingsModal } from '../../../modals/EditWidgetSettingsModal';
import { TicketsListSettings } from '../../tickets-list/TicketsListSettings';
import { WIDGET_PRESET_ICONS } from './constants';
import { LockedFieldsProvider } from '../../../../utils/lockedFieldsContext';

interface FilterOverride {
  column?: string | null;
  value?: string;
  use_doc_number?: boolean;
}

interface SettingsOverride {
  filter?: FilterOverride;
  [k: string]: unknown;
}

function parseOverride(raw: Record<string, unknown> | string | null | undefined): SettingsOverride {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SettingsOverride;
    } catch {
      return {};
    }
  }
  return raw as SettingsOverride;
}

interface WidgetSettingsSectionProps {
  item: { id: number; widget_ref?: number | null; settings_override?: Record<string, unknown> | string | null };
  tableId: number;
}

// Column types where a document id (integer) can't plausibly match row values —
// the "use doc number" shortcut and the plain text input are both hidden for these.
const DOC_NUMBER_INCOMPATIBLE_TYPES = new Set([
  'select', 'multi-select', 'checkbox',
  'datetime', 'time',
  'file', 'image', 'audio', 'color',
  'formula', 'button', 'password',
]);

export function WidgetSettingsSection({ item, tableId }: WidgetSettingsSectionProps) {
  const ctx = useDocumentsContext();
  const widgetId = typeof item.widget_ref === 'number' ? item.widget_ref : null;
  const widgetQuery = useWidget(widgetId ?? 0);
  const widget = widgetId ? widgetQuery.data : null;
  const sourceTableId = widget?.config && typeof (widget.config as Record<string, unknown>).table_id === 'number'
    ? ((widget.config as Record<string, unknown>).table_id as number)
    : null;
  const tableQuery = useTableById(sourceTableId ? String(sourceTableId) : undefined);
  const columnsQuery = useTableColumns(sourceTableId ? String(sourceTableId) : undefined);
  const columns = columnsQuery.data ?? [];
  const presetName = widget?.preset_name || '';
  const presetIcon = presetName ? (WIDGET_PRESET_ICONS[presetName] || '🧩') : '🧩';
  const updateWidget = useUpdateWidget();
  const [editOpen, setEditOpen] = useState(false);
  const bddModeOn = Boolean(widget?.config && (widget.config as Record<string, unknown>).bdd_mode === true);
  const canBddToggle = presetName === 'task_list' && !!widget && !ctx.isReadOnly;
  const isTicketsListPreset = presetName === 'tickets_list' && !!widget;

  // Filter-override local state (hydrated from item.settings_override)
  const initialOverride = useMemo(() => parseOverride(item.settings_override), [item.settings_override]);
  const [filterColumn, setFilterColumn] = useState<string>(initialOverride.filter?.column || '');
  const [filterValue, setFilterValue] = useState<string>(initialOverride.filter?.value || '');
  const [useDocNumber, setUseDocNumber] = useState<boolean>(Boolean(initialOverride.filter?.use_doc_number));
  const [filterDirty, setFilterDirty] = useState(false);
  const [filterSaving, setFilterSaving] = useState(false);

  useEffect(() => {
    const o = parseOverride(item.settings_override);
    setFilterColumn(o.filter?.column || '');
    setFilterValue(o.filter?.value || '');
    setUseDocNumber(Boolean(o.filter?.use_doc_number));
    setFilterDirty(false);
  }, [item.id, item.settings_override]);

  const docNumber = String(ctx.selectedDocument?.id || '');

  // Type-aware filter input: derive column metadata + options for select-like types
  const selectedCol = useMemo(
    () => columns.find(c => c.name === filterColumn),
    [columns, filterColumn],
  );
  const colType = selectedCol?.type;
  const colOptions: Array<{ value: string; label?: string; color?: string }> = useMemo(() => {
    if (colType !== 'select' && colType !== 'multi-select') return [];
    const raw = (selectedCol?.config as Record<string, unknown> | undefined)?.options;
    return Array.isArray(raw) ? (raw as Array<{ value: string; label?: string; color?: string }>) : [];
  }, [colType, selectedCol]);
  const isCheckboxCol = colType === 'checkbox';
  const isSelectLike = colOptions.length > 0;
  const supportsDocNumber = !!colType && !DOC_NUMBER_INCOMPATIBLE_TYPES.has(colType);

  // If user switches to an incompatible column while "use doc number" was on, clear it.
  useEffect(() => {
    if (filterColumn && !supportsDocNumber && useDocNumber) {
      setUseDocNumber(false);
      setFilterDirty(true);
    }
  }, [filterColumn, supportsDocNumber, useDocNumber]);

  const toggleBddMode = async () => {
    if (!widget || ctx.isReadOnly) return;
    await updateWidget.mutateAsync({
      widgetId: widget.id,
      updates: {
        config: {
          ...(widget.config as Record<string, unknown>),
          bdd_mode: !bddModeOn,
        },
      },
    });
  };

  const openPicker = () => {
    if (ctx.isReadOnly) return;
    ctx.setWidgetPickerTarget({ mode: 'replace', itemId: item.id });
  };

  const handleClear = async () => {
    if (ctx.isReadOnly || !ctx.selectedDocumentId) return;
    if (!confirm('Отвязать виджет от этого элемента?')) return;
    await ctx.updateItem({
      documentId: ctx.selectedDocumentId,
      itemId: item.id,
      tableId,
      data: { widget_ref: null },
    });
  };

  const saveFilter = async () => {
    if (!ctx.selectedDocumentId || ctx.isReadOnly) return;
    setFilterSaving(true);
    try {
      const existing = parseOverride(item.settings_override);
      const nextFilter: FilterOverride | undefined = filterColumn
        ? {
            column: filterColumn,
            value: useDocNumber ? '' : filterValue,
            use_doc_number: useDocNumber,
          }
        : undefined;
      const next: SettingsOverride = { ...existing };
      if (nextFilter) next.filter = nextFilter;
      else delete next.filter;
      await ctx.updateItem({
        documentId: ctx.selectedDocumentId,
        itemId: item.id,
        tableId,
        data: { settings_override: next },
      });
      setFilterDirty(false);
    } finally {
      setFilterSaving(false);
    }
  };

  const clearFilter = async () => {
    if (!ctx.selectedDocumentId || ctx.isReadOnly) return;
    setFilterSaving(true);
    try {
      const existing = parseOverride(item.settings_override);
      const next: SettingsOverride = { ...existing };
      delete next.filter;
      await ctx.updateItem({
        documentId: ctx.selectedDocumentId,
        itemId: item.id,
        tableId,
        data: { settings_override: next },
      });
      setFilterColumn('');
      setFilterValue('');
      setUseDocNumber(false);
      setFilterDirty(false);
    } finally {
      setFilterSaving(false);
    }
  };

  const mark = () => setFilterDirty(true);

  return (
    <LockedFieldsProvider settingsOverride={item.settings_override}>
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-cyan-400">🧩</span>
        <span className="text-sm font-medium">Виджет</span>
        {widgetId && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-400 font-mono">
            #{widgetId}
          </span>
        )}
      </div>

      {!widgetId ? (
        <button
          type="button"
          onClick={openPicker}
          disabled={ctx.isReadOnly}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed text-sm",
            ctx.isReadOnly
              ? "border-[var(--border-primary)] text-[var(--text-tertiary)] opacity-60 cursor-default"
              : "border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 cursor-pointer"
          )}
        >
          <Plus className="w-4 h-4" />
          <span>Выбрать виджет</span>
        </button>
      ) : widgetQuery.isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-tertiary)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
        </div>
      ) : widgetQuery.error || !widget ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 text-sm text-red-400">
            Виджет #{widgetId} не найден
          </div>
          <button
            type="button"
            onClick={openPicker}
            disabled={ctx.isReadOnly}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-sm"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Выбрать другой
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-base leading-none">{presetIcon}</span>
              <span className="font-medium truncate" title={widget.title}>{widget.title || 'Без названия'}</span>
            </div>
            {presetName && (
              <div className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">
                {presetName}
              </div>
            )}
            {sourceTableId && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Database className="w-3 h-3" />
                <span className="truncate" title={tableQuery.data?.name || undefined}>
                  {tableQuery.data?.name || `table #${sourceTableId}`}
                </span>
              </div>
            )}
          </div>
          {!ctx.isReadOnly && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openPicker}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-sm"
              >
                <RefreshCcw className="w-3.5 h-3.5" /> Изменить виджет
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/10 hover:text-red-400 text-sm"
                title="Отвязать виджет"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Widget config controls — columns mapping via modal, BDD toggle inline */}
      {widget && (
        <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-sm"
            title="Колонки, заголовок, иконка, источник данных"
          >
            <Settings2 className="w-3.5 h-3.5" /> Настройки виджета
          </button>

          {canBddToggle && (
            <button
              type="button"
              onClick={toggleBddMode}
              disabled={updateWidget.isPending}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
                bddModeOn
                  ? 'bg-green-500/10 border-green-500/40 text-green-400 hover:bg-green-500/15'
                  : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              )}
              title="Переключить виджет в режим BDD-критериев (статусы, priority, locked/unlocked)"
            >
              <CheckCircle2 className={cn('w-3.5 h-3.5', bddModeOn ? 'text-green-400' : 'text-[var(--text-tertiary)]')} />
              <span className="flex-1 text-left">BDD-режим</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono uppercase',
                bddModeOn ? 'bg-green-500/20 text-green-400' : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)]',
              )}>
                {bddModeOn ? 'on' : 'off'}
              </span>
            </button>
          )}

          {isTicketsListPreset && widget && (
            <TicketsListSettings widget={widget} isReadOnly={ctx.isReadOnly} />
          )}
        </div>
      )}

      {/* Per-item filter override */}
      {widget && sourceTableId && (
        <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <span className="font-medium">Фильтр для этого элемента</span>
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">Колонка</label>
            <select
              value={filterColumn}
              onChange={(e) => { setFilterColumn(e.target.value); mark(); }}
              disabled={ctx.isReadOnly || columnsQuery.isLoading}
              className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
            >
              <option value="">— без фильтра —</option>
              {columns.map(c => (
                <option key={c.id} value={c.name}>{c.displayName || c.name}</option>
              ))}
            </select>
          </div>

          {filterColumn && (
            <>
              {supportsDocNumber && (
                <label className={cn(
                  "flex items-center gap-2 text-[11px] cursor-pointer select-none",
                  ctx.isReadOnly && "opacity-60 cursor-default"
                )}>
                  <input
                    type="checkbox"
                    checked={useDocNumber}
                    onChange={(e) => { setUseDocNumber(e.target.checked); mark(); }}
                    disabled={ctx.isReadOnly}
                    className="w-3.5 h-3.5 accent-[var(--color-primary-500)]"
                  />
                  <span className="text-[var(--text-secondary)]">
                    Использовать номер этого документа
                    {docNumber && <span className="ml-1 font-mono text-[var(--text-tertiary)]">({docNumber})</span>}
                  </span>
                </label>
              )}

              <div>
                <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">
                  Значение {useDocNumber && <span className="font-mono">= {docNumber}</span>}
                </label>
                {isSelectLike ? (
                  <select
                    value={useDocNumber ? docNumber : filterValue}
                    onChange={(e) => { setFilterValue(e.target.value); mark(); }}
                    disabled={ctx.isReadOnly || useDocNumber}
                    className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                  >
                    <option value="">— любое значение —</option>
                    {colOptions.map((opt, i) => (
                      <option key={opt.value ?? i} value={opt.value}>
                        {opt.label || opt.value}
                      </option>
                    ))}
                  </select>
                ) : isCheckboxCol ? (
                  <select
                    value={useDocNumber ? docNumber : filterValue}
                    onChange={(e) => { setFilterValue(e.target.value); mark(); }}
                    disabled={ctx.isReadOnly || useDocNumber}
                    className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                  >
                    <option value="">— любое —</option>
                    <option value="true">Да</option>
                    <option value="false">Нет</option>
                  </select>
                ) : (
                  <input
                    type={colType === 'number' ? 'number' : 'text'}
                    value={useDocNumber ? docNumber : filterValue}
                    onChange={(e) => { setFilterValue(e.target.value); mark(); }}
                    disabled={ctx.isReadOnly || useDocNumber}
                    placeholder="введите значение…"
                    className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                  />
                )}
              </div>
            </>
          )}

          {!ctx.isReadOnly && (filterColumn || initialOverride.filter) && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveFilter}
                disabled={!filterDirty || filterSaving}
                className="flex-1 px-3 py-1.5 rounded-md text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {filterSaving ? 'Сохраняем…' : 'Применить фильтр'}
              </button>
              {initialOverride.filter && (
                <button
                  type="button"
                  onClick={clearFilter}
                  disabled={filterSaving}
                  className="px-3 py-1.5 rounded-md text-xs bg-[var(--bg-tertiary)] hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  title="Сбросить фильтр"
                >
                  Сбросить
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {widget && (
        <EditWidgetSettingsModal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          widget={widget}
          onSaved={() => {
            setEditOpen(false);
          }}
        />
      )}
    </div>
    </LockedFieldsProvider>
  );
}
