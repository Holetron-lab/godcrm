/**
 * NavTreeToolbar - Toolbar with visibility toggle, sort mode, expand/collapse, and help
 */

import {
  Eye,
  EyeOff,
  Minus,
  ExpandIcon,
  ShrinkIcon,
  ArrowUpDown,
  ListCollapse,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Popover } from '@/shared/components/ui/Popover';

interface NavTreeToolbarProps {
  allVisible: boolean;
  sortMode: boolean;
  onToggleVisibility: () => void;
  onToggleSortMode: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCollapseTables: () => void; // fold only the tables expanded into their columns
  t: (key: string) => string;
}

export const NavTreeToolbar = ({
  allVisible,
  sortMode,
  onToggleVisibility,
  onToggleSortMode,
  onExpandAll,
  onCollapseAll,
  onCollapseTables,
  t,
}: NavTreeToolbarProps) => {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleVisibility}
        className="p-1 h-auto"
        title={allVisible ? 'Hide all' : 'Show all'}
      >
        {allVisible ? (
          <Eye className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <EyeOff className="w-3.5 h-3.5 text-red-400" />
        )}
      </Button>
      <div className="w-px h-4 bg-[var(--border-primary)]" />
      <Button
        variant={sortMode ? 'default' : 'ghost'}
        size="sm"
        onClick={onToggleSortMode}
        className={`p-1 h-auto ${sortMode ? 'bg-[var(--accent-primary)] text-white' : ''}`}
        title={sortMode ? 'Exit sort mode' : 'Sort mode (drag & drop)'}
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onExpandAll}
        className="p-1 h-auto"
        title="Expand all"
      >
        <ExpandIcon className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCollapseAll}
        className="p-1 h-auto"
        title="Collapse all"
      >
        <ShrinkIcon className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCollapseTables}
        className="p-1 h-auto"
        title={t('schemaEditor.navMenu.collapseTables')}
        aria-label={t('schemaEditor.navMenu.collapseTables')}
      >
        <ListCollapse className="w-3.5 h-3.5" />
      </Button>
      <div className="ml-auto">
        <Popover
          ariaLabel={t('schemaEditor.helpToolbar')}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={t('schemaEditor.helpToolbar')}
              className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[8px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
              title={t('schemaEditor.helpToolbar')}
            >
              ?
            </button>
          }
          content={
            <div className="w-52 text-[10px] text-[var(--text-secondary)]">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <div className="font-medium mb-1">{t('schemaEditor.visibility.title')}</div>
                  <div className="flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-emerald-600 dark:text-green-400" />
                    <span>{t('schemaEditor.visibility.visible')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <EyeOff className="w-3 h-3 text-rose-600 dark:text-red-400" />
                    <span>{t('schemaEditor.visibility.hidden')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Minus className="w-3 h-3 text-amber-600 dark:text-yellow-400" />
                    <span>{t('schemaEditor.visibility.partial')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-gray-400 dark:text-gray-500 opacity-50" />
                    <span>{t('schemaEditor.visibility.inherit')}</span>
                  </div>
                </div>
                <div className="w-px bg-[var(--border-secondary)]" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium mb-1">{t('schemaEditor.connectionLegend.title')}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-green-400" />
                    <span>{t('schemaEditor.connectionLegend.hasRelations')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary-500 dark:bg-primary-400" />
                    <span>{t('schemaEditor.connectionLegend.hasPending')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                    <span>{t('schemaEditor.connectionLegend.hasExternal')}</span>
                  </div>
                </div>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
};
