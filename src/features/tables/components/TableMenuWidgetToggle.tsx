import { Switch } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface TableMenuWidgetToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title?: string;
  description?: string;
}

export const TableMenuWidgetToggle = ({
  checked,
  onCheckedChange,
  title,
  description
}: TableMenuWidgetToggleProps) => {
  const { t } = useLanguage();
  const label = title ?? t('tables.create.addTableWidget');
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--text-primary)]">{label}</h4>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {description ?? t('tables.create.showInMenuDesc')}
          </p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  );
};
