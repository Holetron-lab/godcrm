import { useState, useEffect } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ExternalTableInfo } from '../../types/importWizard.types';

interface SelectIdColumnStepProps {
  tableInfo: ExternalTableInfo;
  selectedColumn?: string;
  onSelect: (columnName: string, isValid: boolean) => void;
}

export function SelectIdColumnStep({ 
  tableInfo, 
  selectedColumn, 
  onSelect 
}: SelectIdColumnStepProps) {
  const { language } = useLanguage();
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; message: string } | null>(null);

  const validateColumn = async (columnName: string) => {
    setValidating(true);
    setValidation(null);
    
    try {
      // TODO: Call API to validate ID column
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Mock validation
      const column = tableInfo.columns.find(c => c.name === columnName);
      const isValid = Boolean(column?.is_primary_key || column?.type.includes('INT'));
      
      setValidation({
        valid: isValid,
        message: isValid 
          ? (language === 'ru' ? 'Колонка валидна для ID' : 'Column is valid for ID')
          : (language === 'ru' ? 'Колонка должна быть числовой или первичным ключом' : 'Column should be numeric or primary key')
      });
      
      onSelect(columnName, isValid);
    } catch (error) {
      setValidation({
        valid: false,
        message: language === 'ru' ? 'Ошибка валидации' : 'Validation error'
      });
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (selectedColumn) {
      validateColumn(selectedColumn);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {language === 'ru' ? 'Выберите ID колонку' : 'Select the ID Column'}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {language === 'ru' 
            ? 'Выберите колонку с уникальными идентификаторами. ID должны быть буквенно-цифровыми (без пробелов и спецсимволов).'
            : 'Choose the column that contains unique identifiers. IDs must be alphanumeric (no spaces or special characters).'}
        </p>
      </div>

      <div className="space-y-2">
        {tableInfo.columns.map((column) => (
          <button type="button" aria-pressed={selectedColumn === column.name}
            key={column.name}
            onClick={() => {
              onSelect(column.name, false);
              validateColumn(column.name);
            }}
            className={`
              w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 text-left p-3 border-2 rounded-lg cursor-pointer transition-all
              ${selectedColumn === column.name
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }
            `}
          >
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-3">
                <code className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {column.name}
                </code>
                <span className="block text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                  {column.type}
                </span>
                {column.is_primary_key && (
                  <span className="block text-xs px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-400 rounded">
                    🔑 PRIMARY KEY
                  </span>
                )}
              </span>
              {selectedColumn === column.name && (
                <span className="block text-xl">✓</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {validating && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span className="animate-spin">🔄</span>
          <span>{language === 'ru' ? 'Проверка колонки...' : 'Validating column...'}</span>
        </div>
      )}

      {validation && (
        <div className={`p-3 rounded-md ${
          validation.valid 
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
        }`}>
          <p className="text-sm font-medium">
            {validation.valid ? '✅' : '❌'} {validation.message}
          </p>
        </div>
      )}
    </div>
  );
}
