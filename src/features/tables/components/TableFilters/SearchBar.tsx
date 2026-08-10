import { useState, useEffect } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { Input, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel } from '../../types/table.types';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchColumns: string[];
  onSearchColumnsChange: (columnIds: string[]) => void;
  columns: ColumnModel[];
  searchableColumns: ColumnModel[];
}

export const SearchBar = ({
  searchQuery,
  onSearchChange,
  searchColumns,
  onSearchColumnsChange,
  columns,
  searchableColumns,
}: SearchBarProps) => {
  const { t } = useLanguage();
  const [inputValue, setInputValue] = useState(searchQuery);
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Sync inputValue with searchQuery prop
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSearch = () => {
    onSearchChange(inputValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClear = () => {
    setInputValue('');
    onSearchChange('');
  };

  const toggleSearchColumn = (columnId: string) => {
    if (searchColumns.includes(columnId)) {
      onSearchColumnsChange(searchColumns.filter(id => id !== columnId));
    } else {
      onSearchColumnsChange([...searchColumns, columnId]);
    }
  };

  return (
    <>
      {/* Search Input */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={t('table.searchPlaceholder') || 'Search in table...'}
          className="pl-9 pr-9"
        />
        {inputValue && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Column Selector Dropdown — always show */}
      <div className="relative">
        <Button
          onClick={() => setShowColumnSelector(!showColumnSelector)}
          variant="outline"
          className="whitespace-nowrap min-w-[140px]"
        >
          <Filter className="h-4 w-4 mr-2 inline" />
          {searchColumns.length === 0
            ? t('table.allColumns') || 'Все колонки'
            : searchColumns.length === searchableColumns.length
            ? t('table.allColumns') || 'Все колонки'
            : `${searchColumns.length} кол.`
          }
        </Button>

              {showColumnSelector && (
                <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">{t('table.searchInColumns')}</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={searchColumns.length === 0 || searchColumns.length === searchableColumns.length}
                        onChange={() => {
                          if (searchColumns.length === 0 || searchColumns.length === searchableColumns.length) {
                            onSearchColumnsChange([]);
                          } else {
                            onSearchColumnsChange(searchableColumns.map(c => c.id));
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">{t('table.allColumns')}</span>
                    </label>
                    <div className="h-px bg-[var(--border-primary)] my-1" />
                    {(searchableColumns.length > 0 ? searchableColumns : (columns || [])).map(column => (
                      <label key={column.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={searchColumns.length === 0 || searchColumns.includes(column.id)}
                          onChange={() => toggleSearchColumn(column.id)}
                          className="rounded"
                        />
                        <span className="text-sm flex items-center gap-1">
                          <span className="flex-shrink-0 leading-none">{column.config?.appearance?.indicator?.value || '📋'}</span>
                          <span className="leading-none">{column.displayName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
      </div>

      <Button onClick={handleSearch} variant="primary" className="whitespace-nowrap min-w-[120px]">
        <Search className="h-4 w-4 mr-2 inline" />
        {t('common.search') || 'Search'}
      </Button>
    </>
  );
};
