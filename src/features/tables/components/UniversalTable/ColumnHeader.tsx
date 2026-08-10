import { Tooltip } from '@/shared/components/ui';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { ColumnModel } from '../../types/table.types';
import type { SortDirection } from '@tanstack/react-table';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ColumnHeaderProps {
  column: ColumnModel;
  onOpenSettings: () => void;
  sortDirection?: SortDirection | false;
  onSort?: () => void;
  rawMode?: boolean;
  disableSettings?: boolean; // Hide settings button for viewer/editor roles
}

const typeEmojiMap: Record<string, string> = {
  text: '📝',
  number: '🔢',
  email: '✉️',
  url: '🔗',
  phone: '📞',
  date: '📅',
  datetime: '⏱️',
  checkbox: '☑️',
  select: '🎯',
  'multi-select': '🧩',
  password: '🔐',
  formula: '∑',
  relation: '🫱🏻‍🫲🏽',
  person: '👤',
  file: '📎',
  rollup: '📊'
};

export const ColumnHeader = ({ column, onOpenSettings, sortDirection, onSort, rawMode, disableSettings }: ColumnHeaderProps) => {
  const { t } = useLanguage();
  const indicator = column.config?.appearance?.indicator;
  const indicatorColor = indicator?.color ?? column.config?.appearance?.color ?? 'var(--text-secondary)';
  const indicatorValue = indicator?.value ?? typeEmojiMap[column.type] ?? '🔣';
  const typeNameTranslated = t(`columnTypes.${column.type}.label`);
  const typeName = typeNameTranslated && typeNameTranslated !== `columnTypes.${column.type}.label`
    ? typeNameTranslated
    : column.type;
  const showHeader = column.config?.appearance?.showHeader !== false; // default true
  
  // In raw mode, always show original column name (key), not displayName
  const headerText = rawMode ? column.name : (column.displayName || column.name);
  
  // Get comment from config
  const comment = column.config?.comment;
  
  // Build tooltip for column name (includes key for admins/owners)
  const buildNameTooltip = () => {
    const parts: string[] = [];
    if (!disableSettings) {
      parts.push(`key: ${column.name}`);
    }
    if (comment) {
      parts.push(comment);
    }
    return parts.length > 0 ? parts.join('\n') : undefined;
  };
  const nameTooltip = buildNameTooltip();

  // Handle settings click - disabled for viewer/editor
  const handleSettingsClick = disableSettings ? undefined : onOpenSettings;

  const getSortIcon = () => {
    if (sortDirection === 'asc') {
      return <ArrowUp className="h-3.5 w-3.5 text-[var(--color-primary-500)]" />;
    }
    if (sortDirection === 'desc') {
      return <ArrowDown className="h-3.5 w-3.5 text-[var(--color-primary-500)]" />;
    }
    return <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />;
  };

  return (
    <div className="flex items-center gap-2 group">
      <Tooltip label={disableSettings ? typeName : `${typeName} • ${t('columnHeader.configureTooltip')}`}>
        <button
          type="button"
          className={`rounded-lg p-1 text-base transition-all ${disableSettings ? 'cursor-default' : 'hover:bg-[var(--bg-tertiary)] hover:scale-110 active:scale-95 cursor-pointer'}`}
          onClick={handleSettingsClick}
          style={{ color: indicatorColor }}
          aria-label={disableSettings ? typeName : `${t('columnHeader.configureAria')} ${headerText}`}
        >
          {indicatorValue}
        </button>
      </Tooltip>
      {showHeader && (
        <Tooltip label={nameTooltip} disabled={!nameTooltip}>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--color-primary-500)] transition-colors cursor-pointer"
            onClick={onSort}
            aria-label={t('columnHeader.sortBy').replace('{column}', headerText)}
          >
            <span>{headerText}</span>
            {getSortIcon()}
          </button>
        </Tooltip>
      )}
      {!showHeader && (
        <button
          type="button"
          className="flex items-center text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          onClick={onSort}
          aria-label={t('columnHeader.sortBy').replace('{column}', headerText)}
        >
          {getSortIcon()}
        </button>
      )}
    </div>
  );
};
