import { useDataSources } from '@/features/data-sources/hooks/useDataSources';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface SelectDataSourceStepProps {
  workspaceId: string;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function SelectDataSourceStep({ 
  workspaceId, 
  selectedId, 
  onSelect 
}: SelectDataSourceStepProps) {
  const { language } = useLanguage();
  const { dataSources, loading } = useDataSources(workspaceId);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">
      {language === 'ru' ? 'Загрузка источников...' : 'Loading data sources...'}
    </div>;
  }

  if (dataSources.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {language === 'ru' 
            ? 'У вас пока нет подключенных источников данных.' 
            : 'You don\'t have any data sources yet.'}
        </p>
        <p className="text-sm text-gray-500">
          {language === 'ru'
            ? 'Добавьте источник данных в меню "Источники данных"'
            : 'Add a data source in the "Data Sources" menu'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {language === 'ru' ? 'Выберите источник данных' : 'Select a data source'}
      </h3>
      
      {dataSources.map((ds) => (
        <button type="button" aria-pressed={selectedId === ds.id}
          key={ds.id}
          onClick={() => onSelect(ds.id)}
          className={`
            w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 text-left p-4 border-2 rounded-lg cursor-pointer transition-all
            ${selectedId === ds.id
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }
          `}
        >
          <span className="flex items-center justify-between">
            <span className="block">
              <span className="block font-semibold text-gray-900 dark:text-gray-100">
                {ds.name}
              </span>
              <span className="block text-sm text-gray-600 dark:text-gray-400">
                {ds.type.toUpperCase()} • {ds.host}:{ds.port} • {ds.database}
              </span>
            </span>
            {selectedId === ds.id && (
              <span className="block text-2xl">✓</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
