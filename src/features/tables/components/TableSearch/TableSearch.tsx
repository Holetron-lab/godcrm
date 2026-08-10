import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface TableSearchProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  onSearch?: (value: string) => void;
}

export const TableSearch = ({ value, onChange, placeholder, onSearch }: TableSearchProps) => {
  const { t } = useLanguage();
  const [inputValue, setInputValue] = useState(value);

  // Sync inputValue with value prop when it changes externally (e.g., when cleared)
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSearch = () => {
    if (onSearch) {
      onSearch(inputValue);
    } else {
      onChange(inputValue);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClear = () => {
    setInputValue('');
    if (onSearch) {
      onSearch('');
    } else if (onChange) {
      onChange('');
    }
  };

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder || t('table.searchPlaceholder') || 'Search in table...'}
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
      <Button onClick={handleSearch} variant="primary" className="gap-2">
        <Search className="h-4 w-4" />
        {t('common.search') || 'Search'}
      </Button>
    </div>
  );
};
