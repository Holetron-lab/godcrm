import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { showToast } from '@/shared/hooks/useToast';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { canEditWidgetColumn } from '../components/presets/WidgetCellEditor';
import { updateWidget } from '../api/widgetsApi';
import type { Widget, WidgetConfig } from '../types/widget.types';

/** Shared by the dashboard and both full-page widget renderers. */
export function useWidgetTableControls(widget?: Widget) {
  const readOnly = useIsPublicReadOnly();
  const client = useQueryClient();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const isTable = widget?.preset_name === 'table_view' || String(widget?.preset_name) === 'table_widget';
  const canConfigure = !!widget && isTable && !readOnly;

  const onConfigChange = async (patch: Partial<WidgetConfig>) => {
    if (!widget || !canConfigure || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const updated = await updateWidget(widget.id, { config: { ...widget.config, ...patch } });
      client.setQueryData(['widget', widget.id], updated);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['widgets'] }),
        client.invalidateQueries({ queryKey: ['widget', widget.id] }),
      ]);
    } catch {
      showToast('Не удалось сохранить настройки колонок. Попробуйте ещё раз.', 'error');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const onCellUpdate = async (rowId: string, field: string, value: unknown) => {
    const tableId = widget?.config?.table_id;
    if (!tableId || readOnly || widget.config?.actions?.edit === false || !widget.config?.editable_columns?.includes(field)) {
      throw new Error('Редактирование колонки заблокировано');
    }
    // Re-read the schema before writing: a column may have become read-only since render.
    const { columns } = await tablesApi.getColumns(String(tableId));
    const column = columns.find(c => c.name === field);
    if (!column || !canEditWidgetColumn(column)) {
      throw new Error('Эта колонка доступна только для чтения');
    }
    if (column.isRequired && (value === null || value === undefined || value === '')) {
      throw new Error('Заполните обязательное поле');
    }
    await tablesApi.updateRow(String(tableId), rowId, { [field]: value });
    await Promise.all([
      client.invalidateQueries({ queryKey: ['ticket-data'] }),
      client.invalidateQueries({ queryKey: ['widget-data'] }),
    ]);
  };

  return { canConfigure, saving, onConfigChange, onCellUpdate };
}
