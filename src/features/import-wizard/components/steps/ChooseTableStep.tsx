import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ExternalTableInfo } from '../../types/importWizard.types';

interface ChooseTableStepProps {
  dataSourceId: string;
  selectedTable?: string;
  onSelect: (tableName: string, tableInfo: ExternalTableInfo) => void;
}

export function ChooseTableStep({ 
  dataSourceId, 
  selectedTable, 
  onSelect 
}: ChooseTableStepProps) {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<ExternalTableInfo[]>([]);

  useEffect(() => {
    // TODO: Fetch tables from data source
    const fetchTables = async () => {
      setLoading(true);
      try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock data
        setTables([
          {
            name: 'orders',
            row_count: 1250,
            columns: [
              { name: 'id', type: 'INT', nullable: false, is_primary_key: true },
              { name: 'customer_id', type: 'INT', nullable: false, is_primary_key: false },
              { name: 'total', type: 'DECIMAL', nullable: false, is_primary_key: false },
              { name: 'status', type: 'VARCHAR', nullable: false, is_primary_key: false },
              { name: 'created_at', type: 'TIMESTAMP', nullable: false, is_primary_key: false }
            ]
          },
          {
            name: 'customers',
            row_count: 450,
            columns: [
              { name: 'id', type: 'INT', nullable: false, is_primary_key: true },
              { name: 'email', type: 'VARCHAR', nullable: false, is_primary_key: false },
              { name: 'name', type: 'VARCHAR', nullable: true, is_primary_key: false }
            ]
          },
          {
            name: 'products',
            row_count: 89,
            columns: [
              { name: 'id', type: 'INT', nullable: false, is_primary_key: true },
              { name: 'title', type: 'VARCHAR', nullable: false, is_primary_key: false },
              { name: 'price', type: 'DECIMAL', nullable: false, is_primary_key: false }
            ]
          }
        ]);
      } catch (error) {
        logger.error('Failed to fetch tables:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, [dataSourceId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">
      {language === 'ru' ? 'Загрузка таблиц...' : 'Loading tables...'}
    </div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {language === 'ru' ? 'Выберите таблицу для импорта' : 'Choose a table to import'}
      </h3>
      
      {tables.map((table) => (
        <button type="button" aria-pressed={selectedTable === table.name}
          key={table.name}
          onClick={() => onSelect(table.name, table)}
          className={`
            w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 text-left p-4 border-2 rounded-lg cursor-pointer transition-all
            ${selectedTable === table.name
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }
          `}
        >
          <span className="flex items-center justify-between">
            <span className="block">
              <span className="block font-semibold text-gray-900 dark:text-gray-100 font-mono">
                {table.name}
              </span>
              <span className="block text-sm text-gray-600 dark:text-gray-400">
                {table.row_count.toLocaleString()} {language === 'ru' ? 'строк' : 'rows'} • {table.columns.length} {language === 'ru' ? 'колонок' : 'columns'}
              </span>
            </span>
            {selectedTable === table.name && (
              <span className="block text-2xl">✓</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
