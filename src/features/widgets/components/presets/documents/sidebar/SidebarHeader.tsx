import React from 'react';
import { LayoutList, List, PanelLeftClose, Plus, Search } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDocumentsContext } from '../DocumentsContext';
import { CATEGORIES_VISIBLE_KEY } from './constants';

interface SidebarHeaderProps {
  showCategories: boolean;
  setShowCategories: (next: boolean) => void;
}

export function SidebarHeader({ showCategories, setShowCategories }: SidebarHeaderProps) {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between p-3 border-b border-[var(--border-primary)]">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          placeholder={t('documents.searchPlaceholder')}
          value={ctx.searchQuery}
          onChange={(e) => ctx.setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm"
        />
      </div>
      {!ctx.isReadOnly && (
        <button
          onClick={() => ctx.setShowCreateDocumentModal(true)}
          className="ml-2 p-1.5 rounded-lg bg-[var(--color-primary-500)]/10 text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20 transition-colors"
          title={t('documents.newDocument')}
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={() => {
          const next = !showCategories;
          setShowCategories(next);
          localStorage.setItem(CATEGORIES_VISIBLE_KEY, String(next));
        }}
        className={cn(
          'ml-2 p-1.5 rounded-lg transition-colors',
          showCategories
            ? 'bg-[var(--color-primary-500)]/10 text-[var(--color-primary-400)]'
            : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
        )}
        title={showCategories ? t('documents.flatList') : t('documents.groupByCategories')}
      >
        {showCategories ? <LayoutList className="w-4 h-4" /> : <List className="w-4 h-4" />}
      </button>
      <button
        onClick={() => {
          if (ctx.isMobile) {
            ctx.setMobileSidebarOpen(false);
          } else {
            ctx.setSidebarCollapsed(true);
          }
        }}
        className="ml-1 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] flex items-center justify-center md:min-h-0 md:min-w-0"
        title={t('documents.hidePanel')}
      >
        <PanelLeftClose className="w-4 h-4" />
      </button>
    </div>
  );
}
