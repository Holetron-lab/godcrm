/**
 * ViewModeToggle - Reusable toggle for list/grid view modes
 * Used in Documents widget for Tickets and Atoms views
 */

import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export type ViewMode = 'list' | 'cards';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function ViewModeToggle({ 
  value, 
  onChange, 
  size = 'md',
  className 
}: ViewModeToggleProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const padding = size === 'sm' ? 'p-1.5' : 'p-2';
  
  return (
    <div className={cn(
      "flex rounded-lg border border-[var(--border-primary)] overflow-hidden",
      className
    )}>
      <button
        onClick={() => onChange('list')}
        title={t('Список', 'List')}
        className={cn(
          padding,
          "transition-colors",
          value === 'list' 
            ? 'bg-blue-500/20 text-blue-400' 
            : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
        )}
      >
        <List className={iconSize} />
      </button>
      <button
        onClick={() => onChange('cards')}
        title={t('Карточки', 'Cards')}
        className={cn(
          padding,
          "transition-colors",
          value === 'cards' 
            ? 'bg-blue-500/20 text-blue-400' 
            : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
        )}
      >
        <LayoutGrid className={iconSize} />
      </button>
    </div>
  );
}

export default ViewModeToggle;
