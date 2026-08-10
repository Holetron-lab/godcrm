import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ImportTableConfig } from '../../types/importWizard.types';

interface PreviewStepProps {
  config: Partial<ImportTableConfig>;
  onUpdateMeta: (meta: { displayName?: string; description?: string; icon?: string }) => void;
}

export function PreviewStep({ config, onUpdateMeta }: PreviewStepProps) {
  const { language } = useLanguage();

  const tableType = (config.customColumns && config.customColumns.length > 0) ? 'hybrid' : 'external';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {language === 'ru' ? 'Просмотр и подтверждение' : 'Preview & Confirm'}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {language === 'ru'
            ? 'Проверьте настройки перед импортом таблицы.'
            : 'Review the settings before importing the table.'}
        </p>
      </div>

      {/* Table Metadata */}
      <div className="space-y-4">
        <Input
          label={language === 'ru' ? 'Название таблицы (отображаемое)' : 'Table Name (Display)'}
          placeholder={config.tableName}
          value={config.displayName || ''}
          onChange={(e) => onUpdateMeta({ displayName: e.target.value })}
        />

        <Input
          label={language === 'ru' ? 'Описание (опционально)' : 'Description (Optional)'}
          placeholder={language === 'ru' ? 'Краткое описание таблицы' : 'Brief table description'}
          value={config.description || ''}
          onChange={(e) => onUpdateMeta({ description: e.target.value })}
        />

        <Input
          label={language === 'ru' ? 'Иконка (эмодзи)' : 'Icon (Emoji)'}
          placeholder="📊"
          value={config.icon || ''}
          onChange={(e) => onUpdateMeta({ icon: e.target.value })}
          maxLength={2}
        />
      </div>

      {/* Summary */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg space-y-3">
        <h4 className="font-semibold text-gray-900 dark:text-gray-100">
          {language === 'ru' ? 'Сводка' : 'Summary'}
        </h4>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {language === 'ru' ? 'Источник данных:' : 'Data Source:'}
            </span>
            <code className="text-gray-900 dark:text-gray-100">{config.dataSourceId}</code>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {language === 'ru' ? 'Таблица:' : 'Table:'}
            </span>
            <code className="font-mono text-gray-900 dark:text-gray-100">{config.tableName}</code>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {language === 'ru' ? 'ID колонка:' : 'ID Column:'}
            </span>
            <code className="font-mono text-gray-900 dark:text-gray-100">{config.idColumn}</code>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {language === 'ru' ? 'Тип таблицы:' : 'Table Type:'}
            </span>
            <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 rounded text-xs font-medium">
              {tableType === 'hybrid' ? (language === 'ru' ? '⚡ Гибридная' : '⚡ Hybrid') : (language === 'ru' ? '🔗 Внешняя' : '🔗 External')}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {language === 'ru' ? 'Синхронизация:' : 'Sync:'}
            </span>
            <span className="text-gray-900 dark:text-gray-100">
              {config.syncConfig?.enabled 
                ? `${language === 'ru' ? 'Каждые' : 'Every'} ${config.syncConfig.interval_minutes} ${language === 'ru' ? 'мин' : 'min'}`
                : (language === 'ru' ? 'Отключена' : 'Disabled')
              }
            </span>
          </div>

          {config.tableInfo && (
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                {language === 'ru' ? 'Внешних колонок:' : 'External Columns:'}
              </span>
              <span className="text-gray-900 dark:text-gray-100">{config.tableInfo.columns.length}</span>
            </div>
          )}

          {config.customColumns && config.customColumns.length > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                {language === 'ru' ? 'Кастомных колонок:' : 'Custom Columns:'}
              </span>
              <span className="text-gray-900 dark:text-gray-100">{config.customColumns.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Custom Columns Preview */}
      {config.customColumns && config.customColumns.length > 0 && (
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <h5 className="font-medium text-purple-900 dark:text-purple-100 mb-2">
            {language === 'ru' ? 'Кастомные колонки:' : 'Custom Columns:'}
          </h5>
          <ul className="space-y-1">
            {config.customColumns.map((col, i) => (
              <li key={i} className="text-sm text-purple-800 dark:text-purple-200">
                • <code className="font-mono">{col.name}</code> ({col.display_name}) - {col.type}
                {col.is_required && <span className="text-red-500">*</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warning */}
      <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <p className="text-sm text-yellow-900 dark:text-yellow-100">
          ⚠️ {language === 'ru'
            ? 'После импорта таблица будет доступна в проекте. Внешние данные будут синхронизироваться автоматически согласно настройкам.'
            : 'After import, the table will be available in the project. External data will sync automatically according to settings.'}
        </p>
      </div>
    </div>
  );
}
