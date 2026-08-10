import { Search, Atom } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDocumentsContext } from '../DocumentsContext';

export function ToolbarSearch() {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();

  return (
    <div className={cn("flex-1 max-w-md mx-4", ctx.isMobile && "mx-1 max-w-none")}>
      <div className="relative">
        {ctx.ticketsViewMode ? (
          /* Tickets search */
          <>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
            <input
              type="text"
              placeholder={t('documents.searchTicketsPlaceholder')}
              value={ctx.searchQuery}
              onChange={(e) => ctx.setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm focus:border-blue-500/50"
            />
          </>
        ) : ctx.atomsViewMode || (ctx.rightPanelMode === 'atoms' && ctx.rightPanelOpen) ? (
          /* Atoms search */
          <>
            <Atom className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
            <input
              type="text"
              placeholder={t('documents.searchAtomsPlaceholder')}
              value={ctx.atomsPanelSearchQuery}
              onChange={(e) => ctx.setAtomsPanelSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-sm focus:border-purple-500/50"
            />
          </>
        ) : ctx.selectedDocument || ctx.isCreatingMode ? (
          /* Content search (inside an open document) */
          <>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder={ctx.selectedDocument ? `${t('documents.searchIn')} "${ctx.selectedDocument.name}"...` : t('documents.searchInDocPlaceholder')}
              value={ctx.contentSearchQuery}
              onChange={(e) => ctx.setContentSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm"
            />
          </>
        ) : (
          /* Grid search (filter the documents grid by name/description/category) */
          <>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder={t('documents.searchDocsPlaceholder')}
              value={ctx.searchQuery}
              onChange={(e) => ctx.setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm"
            />
          </>
        )}
      </div>
    </div>
  );
}
