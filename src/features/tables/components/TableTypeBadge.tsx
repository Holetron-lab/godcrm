import { TableType } from '../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface TableTypeBadgeProps {
  type: TableType;
  className?: string;
}

const typeConfig = {
  own: {
    label: { en: 'Own Table', ru: 'Своя таблица' },
    color: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400 border-primary-300 dark:border-primary-700',
    icon: '📝',
    description: { en: 'Created in GOD CRM', ru: 'Создана в GOD CRM' }
  },
  external: {
    label: { en: 'External', ru: 'Внешняя' },
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700',
    icon: '🔗',
    description: { en: 'Synced from external database', ru: 'Синхронизация с внешней БД' }
  },
  hybrid: {
    label: { en: 'Hybrid', ru: 'Гибридная' },
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-300 dark:border-purple-700',
    icon: '⚡',
    description: { en: 'External data + custom fields', ru: 'Внешние данные + кастомные поля' }
  }
};

export function TableTypeBadge({ type, className = '' }: TableTypeBadgeProps) {
  const { language } = useLanguage();
  const config = typeConfig[type];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${config.color} ${className}`}
      title={config.description[language]}
    >
      <span>{config.icon}</span>
      <span>{config.label[language]}</span>
    </span>
  );
}
