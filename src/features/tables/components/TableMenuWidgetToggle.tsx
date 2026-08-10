import { Switch } from '@/shared/components/ui';

interface TableMenuWidgetToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title?: string;
  description?: string;
}

export const TableMenuWidgetToggle = ({
  checked,
  onCheckedChange,
  title = 'Добавить виджет-таблицу',
  description = 'Отображать таблицу в левом меню как виджет'
}: TableMenuWidgetToggleProps) => {
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--text-primary)]">{title}</h4>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {description}
          </p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
};
