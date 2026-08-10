import type { ColumnModel } from '../../types/table.types';
import { Checkbox, Input, Select } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ColumnConfigPanelProps {
  columns: ColumnModel[];
  onChangeWidth?: (columnId: string, width: number) => void;
  onToggleVisibility?: (columnId: string, isVisible: boolean) => void;
}

const alignOptions = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' }
];

export const ColumnConfigPanel = ({ columns, onChangeWidth, onToggleVisibility }: ColumnConfigPanelProps) => {
  const { t } = useLanguage();
  if (!columns?.length) {
    return <p className="text-sm text-[var(--text-secondary)]">{t('columnConfig.noColumns')}</p>;
  }

  return (
    <div className="space-y-6">
      {(columns || []).map((column) => (
        <div key={column.id} className="rounded-xl border border-[var(--border-secondary)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{column.displayName}</p>
              <p className="text-xs text-[var(--text-secondary)]">{column.type.toUpperCase()}</p>
            </div>
            <Checkbox
              checked={column.isVisible}
              onCheckedChange={(checked) => onToggleVisibility?.(column.id, checked === true)}
              label={t('columnConfig.visible')}
              description={t('columnConfig.toggleVisibility')}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label={t('columnConfig.width')}
              type="number"
              name={`width-${column.id}`}
              defaultValue={column.width}
              onBlur={(event) => onChangeWidth?.(column.id, Number(event.target.value))}
            />
            <Select
              label={t('columnConfig.align')}
              id={`align-${column.id}`}
              value={column.config?.appearance?.align}
              onChange={() => {}}
              options={alignOptions}
              placeholder={t('columnConfig.auto')}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
