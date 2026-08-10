/**
 * MobileBottomNav - Fixed bottom navigation bar for mobile Documents view
 * ADR-105 AC10: Mobile-responsive Documents layout
 *
 * Provides:
 * - Previous/Next document navigation
 * - Table of Contents (opens bottom sheet)
 * - Touch-friendly 44px min-height targets
 */

import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from './DocumentsContext';

export function MobileBottomNav() {
  const ctx = useDocumentsContext();

  // Find current document index
  const currentIndex = ctx.documents.findIndex(d => d.id === ctx.selectedDocumentId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < ctx.documents.length - 1;

  const goToPrev = () => {
    if (hasPrev) {
      ctx.setSelectedDocumentId(ctx.documents[currentIndex - 1].id);
    }
  };

  const goToNext = () => {
    if (hasNext) {
      ctx.setSelectedDocumentId(ctx.documents[currentIndex + 1].id);
    }
  };

  return (
    <div className="shrink-0 flex items-center justify-between border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 z-30 md:hidden">
      {/* Previous Document */}
      <button
        onClick={goToPrev}
        disabled={!hasPrev}
        className={cn(
          "flex items-center gap-1 px-3 min-h-[44px] min-w-[44px] rounded-lg text-sm font-medium transition-colors",
          hasPrev
            ? "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]"
            : "text-[var(--text-tertiary)] opacity-40"
        )}
      >
        <ChevronLeft className="w-5 h-5" />
        <span className="hidden xs:inline">Prev</span>
      </button>

      {/* Table of Contents */}
      <button
        onClick={() => ctx.setMobileTocOpen(!ctx.mobileTocOpen)}
        className={cn(
          "flex items-center gap-1.5 px-4 min-h-[44px] min-w-[44px] rounded-lg text-sm font-medium transition-colors",
          "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]",
          ctx.mobileTocOpen && "bg-[var(--color-primary-500)]/10 text-[var(--color-primary-400)]"
        )}
      >
        <List className="w-5 h-5" />
        <span>TOC</span>
      </button>

      {/* Next Document */}
      <button
        onClick={goToNext}
        disabled={!hasNext}
        className={cn(
          "flex items-center gap-1 px-3 min-h-[44px] min-w-[44px] rounded-lg text-sm font-medium transition-colors",
          hasNext
            ? "text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]"
            : "text-[var(--text-tertiary)] opacity-40"
        )}
      >
        <span className="hidden xs:inline">Next</span>
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
