import { DataSource } from '../types/dataSource.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale/ru';
import { enUS } from 'date-fns/locale/en-US';

interface DataSourceCardProps {
  dataSource: DataSource;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const statusConfig = {
  connected: {
    icon: '✅',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800'
  },
  disconnected: {
    icon: '❌',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800'
  },
  testing: {
    icon: '🔄',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800'
  },
  error: {
    icon: '⚠️',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800'
  }
};

const dbIcons: Record<string, string> = {
  mysql: '🐬',
  postgresql: '🐘',
  sqlite: '📦'
};

export function DataSourceCard({ dataSource, onTest, onEdit, onDelete }: DataSourceCardProps) {
  const { t, language } = useLanguage();
  const currentStatus = dataSource.status || 'disconnected';
  const status = statusConfig[currentStatus];
  const dbIcon = dbIcons[dataSource.type] || '🔌';

  const formatLastSync = (dateStr: string | null | undefined) => {
    if (!dateStr) return t('dataSources.card.never');
    
    try {
      const locale = language === 'ru' ? ru : enUS;
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale
      });
    } catch {
      return t('dataSources.card.never');
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 hover:shadow-lg transition-shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{dbIcon}</span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {dataSource.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {dataSource.type.toUpperCase()}
              </p>
            </div>
          </div>
          
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${status.bgColor} ${status.color} ${status.borderColor} border`}>
            <span>{status.icon}</span>
            <span>{t(`dataSources.card.status${String(currentStatus || '').charAt(0).toUpperCase()}${String(currentStatus || '').slice(1)}`)}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {dataSource.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {dataSource.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span>🔄</span>
            <span className="text-xs">
              {t('dataSources.card.lastSync')}: <strong>{formatLastSync(dataSource.last_sync_at)}</strong>
            </span>
          </div>
          
          {dataSource.table_count !== undefined && (
            <div className="flex items-center gap-1">
              <span>📊</span>
              <span className="text-xs">
                {t('dataSources.card.tables')}: <strong>{dataSource.table_count}</strong>
              </span>
            </div>
          )}
        </div>

        {dataSource.last_error && (
          <div className="mt-2 px-2 py-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
            {dataSource.last_error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <button
          onClick={onTest}
          className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('dataSources.card.testConnection')}
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('dataSources.card.edit')}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          {t('dataSources.card.delete')}
        </button>
      </div>
    </div>
  );
}
