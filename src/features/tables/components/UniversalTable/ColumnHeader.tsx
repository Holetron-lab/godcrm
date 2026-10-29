import { DropdownMenu, Tooltip } from '@/shared/components/ui';
import { ArrowUp, ArrowDown, ArrowUpDown, ArrowLeftRight, MoreVertical, Settings2, EyeOff, Search, Layers, Lock, Unlock, Trash2, Plus } from 'lucide-react';
import { useContext } from 'react';
import { ColumnDragContext } from './DraggableColumnHeader';
import type { ColumnModel } from '../../types/table.types';
import type { SortDirection } from '@tanstack/react-table';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { isSystemColumnId } from '../../utils/systemColumns';

interface ColumnHeaderProps {
  column: ColumnModel;
  onOpenSettings: () => void;
  sortDirection?: SortDirection | false;
  onSort?: () => void;
  rawMode?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onAddColumn?: (side: 'left' | 'right') => void;
  disableSettings?: boolean; // Hide settings button for viewer/editor roles
  // Column-menu shortcuts that mirror the toolbar / settings drawer; each item is hidden when its handler is absent
  onHide?: () => void;
  onSearchHere?: () => void;
  isSearchScoped?: boolean; // search already narrowed to this column → item toggles back to all columns
  onGroupBy?: () => void;
  isGrouped?: boolean;
  onToggleLock?: () => void;
  onDelete?: () => void; // caller owns the confirmation
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

export const ColumnHeader = ({ column, onOpenSettings, sortDirection, onSort, rawMode, disableSettings, onMoveLeft, onMoveRight, onAddColumn, onHide, onSearchHere, isSearchScoped, onGroupBy, isGrouped, onToggleLock, onDelete }: ColumnHeaderProps) => {
  const { t } = useLanguage();
  const drag = useContext(ColumnDragContext);
  const canDrag = drag && !disableSettings && !isSystemColumnId(column.id);
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


  const getSortIcon = () => {
    if (sortDirection === 'asc') {
      return <ArrowUp className="h-3.5 w-3.5 text-[var(--color-primary-500)]" />;
    }
    if (sortDirection === 'desc') {
      return <ArrowDown className="h-3.5 w-3.5 text-[var(--color-primary-500)]" />;
    }
    return <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />;
  };

  const isSorted = sortDirection === 'asc' || sortDirection === 'desc';

  return (
    <div className="group -mr-2 flex min-w-0 items-center gap-1">
      <Tooltip label={canDrag ? `${typeName} · ${t('columnHeader.drag', { column: headerText })}` : typeName}>
        {canDrag ? <button
          type="button"
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          aria-label={t('columnHeader.drag', { column: headerText })}
          className="flex h-7 w-7 shrink-0 touch-none select-none cursor-grab items-center justify-center rounded text-base hover:bg-[var(--bg-tertiary)] active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
          style={{ color: indicatorColor }}
        >{indicatorValue}</button> : <span className="shrink-0 p-1 text-base" style={{ color: indicatorColor }} aria-label={typeName}>
          {indicatorValue}
        </span>}
      </Tooltip>
      {showHeader && (
        <Tooltip label={nameTooltip || ''}>
          {disableSettings ? <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">{headerText}</span> : <button
            type="button"
            className="min-w-0 truncate rounded text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--color-primary-500)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
            onClick={onOpenSettings}
          >
            {headerText}
          </button>}
        </Tooltip>
      )}
      {onSort && (
        <button
          type="button"
          className={`ml-auto flex h-7 w-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-[var(--bg-tertiary)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] ${
            isSorted ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
          onClick={onSort}
          aria-label={t('columnHeader.sortBy').replace('{column}', headerText)}
        >
          {getSortIcon()}
        </button>
      )}
      {!disableSettings && (
        <div className={`${onSort ? '' : 'ml-auto'} flex shrink-0 items-center`}>
          <DropdownMenu
            trigger={<button type="button" aria-label={t('columnHeader.actions', { column: headerText })}
              className="flex h-7 w-4 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]">
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </button>}
            items={[
              { label: t('columnHeader.settings'), value: 'settings', icon: <Settings2 className="h-4 w-4" />, onSelect: onOpenSettings },
              ...(onHide ? [{ label: t('columnHeader.hide'), value: 'hide', icon: <EyeOff className="h-4 w-4" />, onSelect: onHide }] : []),
              ...(onSearchHere ? [{ label: t(isSearchScoped ? 'columnHeader.searchHereOff' : 'columnHeader.searchHere'), value: 'search', icon: <Search className="h-4 w-4" />, active: isSearchScoped, onSelect: onSearchHere }] : []),
              ...(onGroupBy ? [{ label: t(isGrouped ? 'columnHeader.groupByOff' : 'columnHeader.groupBy'), value: 'group', icon: <Layers className="h-4 w-4" />, active: isGrouped, onSelect: onGroupBy }] : []),
              ...((onMoveLeft || onMoveRight) ? [{ label: t('columnHeader.move'), value: 'move', icon: <ArrowLeftRight className="h-4 w-4" />, submenu: [
                ...(onMoveLeft ? [{ label: t('columnHeader.moveLeft'), value: 'left', onSelect: onMoveLeft }] : []),
                ...(onMoveRight ? [{ label: t('columnHeader.moveRight'), value: 'right', onSelect: onMoveRight }] : []),
              ] }] : []),
              ...(onAddColumn ? [{ label: t('columnHeader.add'), value: 'add', icon: <Plus className="h-4 w-4" />, submenu: [
                { label: t('columnHeader.addLeft'), value: 'add-left', onSelect: () => onAddColumn('left') },
                { label: t('columnHeader.addRight'), value: 'add-right', onSelect: () => onAddColumn('right') },
              ] }] : []),
              ...(onToggleLock ? [{ label: t(column.isReadonly ? 'columnHeader.readOnlyOff' : 'columnHeader.readOnly'), value: 'readonly', icon: column.isReadonly ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />, active: column.isReadonly, onSelect: onToggleLock }] : []),
              ...(onDelete ? [{ label: t('columnHeader.delete'), value: 'delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: onDelete }] : []),
            ]}
          />
        </div>
      )}
    </div>
  );
};
