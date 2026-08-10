/**
 * ColumnCardHeader - Collapsed header row of a column card
 */
import { ChevronRight, Eye, EyeOff, Settings2, X } from 'lucide-react';
import { EmojiPicker } from '../UniversalTable/EmojiPicker';
import type { ColumnCardHeaderProps } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export const ColumnCardHeader = ({
  column,
  isExpanded,
  isHidden,
  onToggleExpand,
  onToggleHidden,
  onUpdate,
  onDelete,
  onRequestKeyEdit,
  onOpenSettings,
  keyEditable,
  columnTypes
}: ColumnCardHeaderProps) => {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2 p-2">
      {/* Expand button */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
      >
        <ChevronRight className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Column display name */}
      <span className={`text-sm flex-shrink-0 w-24 truncate ${isHidden ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>
        {column.displayName || column.name}
      </span>

      {/* Arrow separator */}
      <span className="text-[var(--text-tertiary)]">{'\u2192'}</span>

      {/* Key input + edit guard */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={column.name}
          disabled={!keyEditable}
          onChange={(e) => onUpdate('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          className={`flex-shrink-0 w-32 px-2 py-1 rounded border text-xs font-mono ${
            keyEditable
              ? 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]'
              : 'bg-[var(--bg-tertiary)]/40 border-dashed border-[var(--border-secondary)] text-[var(--text-tertiary)] cursor-not-allowed'
          }`}
        />
        {!keyEditable && (
          <button
            type="button"
            onClick={onRequestKeyEdit}
            className="text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            {t('tableEditing.editKey')}
          </button>
        )}
      </div>

      {/* Icon picker */}
      <EmojiPicker
        value={column.icon || '\uD83D\uDCC1'}
        onChange={(v) => onUpdate('icon', v)}
        compact
        size="sm"
      />

      {/* Display name input */}
      <input
        type="text"
        value={column.displayName || ''}
        onChange={(e) => onUpdate('displayName', e.target.value)}
        placeholder={t('tableEditing.namePlaceholder')}
        className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
      />

      {/* Type select - without emoji */}
      <select
        value={column.type}
        onChange={(e) => onUpdate('type', e.target.value)}
        className="flex-shrink-0 w-28 px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
      >
        {columnTypes.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Full settings (opens ColumnSettingsDrawer over the modal) */}
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--color-primary-500)]"
          title={t('tableEditing.fullSettings')}
        >
          <Settings2 className="w-4 h-4" />
        </button>
      )}

      {/* Visibility toggle */}
      <button
        type="button"
        onClick={onToggleHidden}
        className={`p-1.5 rounded transition-colors ${
          isHidden
            ? 'text-orange-500 bg-orange-500/10 hover:bg-orange-500/20'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
        }`}
        title={isHidden ? t('tableEditing.showColumn') : t('tableEditing.hideColumn')}
      >
        {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={onDelete}
        className="p-1.5 rounded transition-colors text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
        title={t('tableEditing.deleteColumn')}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
