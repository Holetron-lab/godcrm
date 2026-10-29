import { Switch } from '@/shared/components/ui/Switch';
import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { SyncConfig } from '../../types/importWizard.types';

interface ConfigureSyncStepProps {
  config: SyncConfig;
  onChange: (config: SyncConfig) => void;
}

export function ConfigureSyncStep({ config, onChange }: ConfigureSyncStepProps) {
  const { language } = useLanguage();

  const intervalOptions = [
    { value: 5, label: language === 'ru' ? '5 минут' : '5 minutes' },
    { value: 15, label: language === 'ru' ? '15 минут' : '15 minutes' },
    { value: 30, label: language === 'ru' ? '30 минут' : '30 minutes' },
    { value: 60, label: language === 'ru' ? '1 час' : '1 hour' },
    { value: 180, label: language === 'ru' ? '3 часа' : '3 hours' },
    { value: 360, label: language === 'ru' ? '6 часов' : '6 hours' },
    { value: 720, label: language === 'ru' ? '12 часов' : '12 hours' },
    { value: 1440, label: language === 'ru' ? '24 часа' : '24 hours' }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {language === 'ru' ? 'Настройка синхронизации' : 'Configure Sync'}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {language === 'ru'
            ? 'Настройте автоматическую синхронизацию данных из внешней базы.'
            : 'Configure automatic data synchronization from the external database.'}
        </p>
      </div>

      {/* Enable Sync */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {language === 'ru' ? 'Включить автоматическую синхронизацию' : 'Enable automatic sync'}
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {language === 'ru'
              ? 'Данные будут обновляться по расписанию'
              : 'Data will be updated on schedule'}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onChange({ ...config, enabled })}
        />
      </div>

      {/* Sync Interval */}
      {config.enabled && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {language === 'ru' ? 'Интервал синхронизации' : 'Sync Interval'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {intervalOptions.map((option) => (
              <button type="button" aria-pressed={config.interval_minutes === option.value}
                key={option.value}
                onClick={() => onChange({ ...config, interval_minutes: option.value })}
                className={`
                  w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 p-3 border-2 rounded-lg cursor-pointer text-center transition-all
                  ${config.interval_minutes === option.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-900 dark:text-primary-100'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <span className="block text-sm font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auto Archive Deleted */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">
            {language === 'ru' ? 'Автоматически архивировать удаленные записи' : 'Auto-archive deleted rows'}
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {language === 'ru'
              ? 'Записи, удаленные из источника, будут помечены как архивные'
              : 'Rows deleted from source will be marked as archived'}
          </p>
        </div>
        <Switch
          checked={config.auto_archive_deleted}
          onCheckedChange={(auto_archive_deleted) => onChange({ ...config, auto_archive_deleted })}
        />
      </div>

      {/* Info Box */}
      <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
        <p className="text-sm text-primary-900 dark:text-primary-100">
          💡 {language === 'ru'
            ? 'Вы всегда можете запустить синхронизацию вручную из интерфейса таблицы.'
            : 'You can always trigger sync manually from the table interface.'}
        </p>
      </div>
    </div>
  );
}
