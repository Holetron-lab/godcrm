import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel } from '../../types/table.types';

interface AddFilterDropdownProps {
  availableFilterColumns: ColumnModel[];
  onAddFilter: (columnId: string) => void;
}

export const AddFilterDropdown = ({
  availableFilterColumns,
  onAddFilter,
}: AddFilterDropdownProps) => {
  const { t } = useLanguage();
  const [showAddFilter, setShowAddFilter] = useState(false);

  if (availableFilterColumns.length === 0) return null;

  const handleAddFilter = (columnId: string) => {
    onAddFilter(columnId);
    setShowAddFilter(false);
  };

  return (
    <div className="relative">
      <Button
        onClick={() => setShowAddFilter(!showAddFilter)}
        variant="secondary"
        className="whitespace-nowrap"
      >
        <Plus className="h-4 w-4 mr-2 inline" />
        {t('table.addFilter')}
      </Button>

      {showAddFilter && (
        <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <div className="text-xs font-medium text-[var(--text-secondary)]">{t('table.selectColumn')}</div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
            {availableFilterColumns.map(column => (
              <button
                key={column.id}
                onClick={() => handleAddFilter(column.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors text-left"
              >
                <span className="text-sm flex items-center gap-1">
                  <span className="flex-shrink-0 leading-none">{column.config?.appearance?.indicator?.value || '📋'}</span>
                  <span className="leading-none">{column.displayName}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
