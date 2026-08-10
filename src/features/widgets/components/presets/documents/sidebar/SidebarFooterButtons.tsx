import React from 'react';
import { Atom, Ticket } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDocumentsContext } from '../DocumentsContext';

interface SidebarFooterButtonsProps {
  ticketsCount: number;
  /**
   * Optional override for the atoms-tab badge. When provided, takes precedence
   * over `ctx.allAtoms.length` — caller passes a doc-scoped count when a
   * document is open, project-wide otherwise.
   */
  atomsCount?: number;
}

export function SidebarFooterButtons({ ticketsCount, atomsCount }: SidebarFooterButtonsProps) {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();
  const atomsDisplay = atomsCount ?? (ctx.allAtoms?.length || 0);
  return (
    <div className="shrink-0 flex border-t border-[var(--border-primary)]">
      <button
        onClick={() => {
          ctx.setAtomsViewMode(true);
          ctx.setTicketsViewMode(false);
          ctx.setShowDocumentsGrid(false);
          ctx.setAtomsPanelSearchQuery('');
        }}
        className={cn(
          'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 transition-colors',
          ctx.atomsViewMode
            ? 'bg-purple-500/10 text-purple-400'
            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
        )}
      >
        <Atom className="w-4 h-4" />
        <span className="text-sm font-medium">{t('documents.atoms')}</span>
        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-400">
          {atomsDisplay}
        </span>
      </button>
      <button
        onClick={() => {
          ctx.setTicketsViewMode(!ctx.ticketsViewMode);
          ctx.setAtomsViewMode(false);
          ctx.setShowDocumentsGrid(false);
        }}
        className={cn(
          'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 border-l border-[var(--border-primary)] transition-colors',
          ctx.ticketsViewMode
            ? 'bg-blue-500/10 text-blue-400'
            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
        )}
      >
        <Ticket className="w-4 h-4" />
        <span className="text-sm font-medium">{t('documents.tickets')}</span>
        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-400">
          {ticketsCount}
        </span>
      </button>
    </div>
  );
}
