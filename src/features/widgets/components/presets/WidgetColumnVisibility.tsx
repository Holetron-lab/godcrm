import { Eye } from 'lucide-react';
import { Popover } from '@/shared/components/ui/Popover';
import { useLanguage } from '@/shared/i18n/LanguageContext';
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
  const { t } = useLanguage();
  return <fieldset disabled={disabled} className="max-h-80 overflow-auto">
    <legend className="text-sm font-medium mb-2">{t('widgets.tableControls.columnVisibility')}</legend>
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
  const { t } = useLanguage();
  const label = t('widgets.tableControls.columnVisibility');
  return <Popover align="start" ariaLabel={label}
    trigger={<button type="button" title={label} aria-label={label} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]"><Eye className="w-4 h-4" /></button>}
    content={<WidgetColumnChecklist {...props} />} />;
}
