import { useMemo, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Select } from '@/shared/components/ui/Select';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { CustomColumnDefinition } from '../../types/importWizard.types';
import { getColumnTypeOptions } from '@/shared/types';

interface AddCustomColumnsStepProps {
  columns: CustomColumnDefinition[];
  onChange: (columns: CustomColumnDefinition[]) => void;
}

export function AddCustomColumnsStep({ columns, onChange }: AddCustomColumnsStepProps) {
  const { language } = useLanguage();
  const [editingColumn, setEditingColumn] = useState<Partial<CustomColumnDefinition> | null>(null);

  const columnTypes = useMemo(() => getColumnTypeOptions(language as 'ru' | 'en'), [language]);

  const handleAddColumn = () => {
    if (!editingColumn?.name || !editingColumn?.display_name || !editingColumn?.type) {
      return;
    }

    onChange([
      ...columns,
      {
        name: editingColumn.name,
        display_name: editingColumn.display_name,
        type: editingColumn.type,
        is_required: editingColumn.is_required || false
      }
    ]);

    setEditingColumn(null);
  };

  const handleRemoveColumn = (index: number) => {
    onChange(columns.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {language === 'ru' ? 'Добавить кастомные колонки (опционально)' : 'Add Custom Columns (Optional)'}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {language === 'ru'
            ? 'Создайте дополнительные поля, которые будут редактироваться только в GOD CRM.'
            : 'Create additional fields that will be editable only in GOD CRM.'}
        </p>
      </div>

      {/* Existing Custom Columns */}
      {columns.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {language === 'ru' ? 'Кастомные колонки' : 'Custom Columns'} ({columns.length})
          </h4>
          {columns.map((column, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div>
                <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {column.name}
                </code>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                  ({column.display_name})
                </span>
                <span className="ml-2 text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 rounded">
                  {column.type}
                </span>
                {column.is_required && (
                  <span className="ml-2 text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 rounded">
                    *
                  </span>
                )}
              </div>
              <Button
                variant="danger"
                onClick={() => handleRemoveColumn(index)}
                className="text-xs"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add New Column Form */}
      {editingColumn ? (
        <div className="p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg space-y-4">
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {language === 'ru' ? 'Новая колонка' : 'New Column'}
          </h4>

          <Input
            label={language === 'ru' ? 'Имя поля (для API)' : 'Field Name (for API)'}
            placeholder="custom_field_1"
            value={editingColumn.name || ''}
            onChange={(e) => setEditingColumn({ ...editingColumn, name: e.target.value.toLowerCase().replace(/\s/g, '_') })}
          />

          <Input
            label={language === 'ru' ? 'Отображаемое имя' : 'Display Name'}
            placeholder={language === 'ru' ? 'Моя колонка' : 'My Column'}
            value={editingColumn.display_name || ''}
            onChange={(e) => setEditingColumn({ ...editingColumn, display_name: e.target.value })}
          />

          <Select
            label={language === 'ru' ? 'Тип данных' : 'Data Type'}
            value={editingColumn.type || 'text'}
            onChange={(value) => setEditingColumn({ ...editingColumn, type: value })}
            options={columnTypes}
          />

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-required"
              checked={editingColumn.is_required || false}
              onChange={(e) => setEditingColumn({ ...editingColumn, is_required: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="is-required" className="text-sm text-gray-700 dark:text-gray-300">
              {language === 'ru' ? 'Обязательное поле' : 'Required field'}
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleAddColumn}
              disabled={!editingColumn.name || !editingColumn.display_name}
            >
              {language === 'ru' ? 'Добавить колонку' : 'Add Column'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setEditingColumn(null)}
            >
              {language === 'ru' ? 'Отмена' : 'Cancel'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setEditingColumn({ type: 'text', is_required: false })}
        >
          + {language === 'ru' ? 'Добавить кастомную колонку' : 'Add Custom Column'}
        </Button>
      )}

      {/* Info */}
      <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
        <p className="text-sm text-purple-900 dark:text-purple-100">
          💡 {language === 'ru'
            ? 'Кастомные поля будут доступны только для редактирования в GOD CRM и не будут синхронизироваться с внешней базой.'
            : 'Custom fields will only be editable in GOD CRM and will not sync to the external database.'}
        </p>
      </div>
    </div>
  );
}
