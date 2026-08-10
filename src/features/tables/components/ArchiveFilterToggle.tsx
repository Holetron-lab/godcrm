import { Switch } from '@/shared/components/ui/Switch';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ArchiveFilterToggleProps {
  showArchived: boolean;
  onToggle: (show: boolean) => void;
  archivedCount?: number;
}

export function ArchiveFilterToggle({ 
  showArchived, 
  onToggle,
  archivedCount = 0 
}: ArchiveFilterToggleProps) {
  const { language } = useLanguage();
  
  const label = language === 'ru' 
    ? 'Показать архивированные строки' 
    : 'Show archived rows';

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-md">
      <Switch
        checked={showArchived}
        onCheckedChange={onToggle}
        id="show-archived"
      />
      <label 
        htmlFor="show-archived" 
        className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none"
      >
        {label}
        {archivedCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-xs rounded-full">
            {archivedCount}
          </span>
        )}
      </label>
    </div>
  );
}
