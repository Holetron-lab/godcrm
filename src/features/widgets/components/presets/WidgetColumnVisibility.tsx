import { Eye } from 'lucide-react';
import { Popover } from '@/shared/components/ui/Popover';
import type { WidgetConfig } from '../../types/widget.types';

interface Props {
  columns: Array<{ name: string; displayName?: string }>;
  config: WidgetConfig;
  onChange: (patch: Partial<WidgetConfig>) => void;
  disabled?: boolean;
}

export function isWidgetColumnVisible(config: WidgetConfig, name: string) {
  return (!config.visible_columns?.length || config.visible_columns.includes(name)) && !config.hidden_columns?.includes(name);
}

export function WidgetColumnChecklist({ columns, config, onChange, disabled }: Props) {
  return <fieldset disabled={disabled} className="max-h-80 overflow-auto">
    <legend className="text-sm font-medium mb-2">Видимость колонок в виджете</legend>
    {columns.map(column => <label key={column.name} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
      <input type="checkbox" checked={isWidgetColumnVisible(config, column.name)} onChange={event => {
        const hidden = columns.filter(c => c.name === column.name ? !event.target.checked : !isWidgetColumnVisible(config, c.name)).map(c => c.name);
        onChange({ visible_columns: [], hidden_columns: hidden });
      }} />
      <span>{column.displayName || column.name}</span>
    </label>)}
  </fieldset>;
}

export function WidgetColumnVisibility(props: Props) {
  return <Popover align="start" ariaLabel="Видимость колонок в виджете"
    trigger={<button type="button" title="Видимость колонок в виджете" aria-label="Видимость колонок в виджете" className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]"><Eye className="w-4 h-4" /></button>}
    content={<WidgetColumnChecklist {...props} />} />;
}
