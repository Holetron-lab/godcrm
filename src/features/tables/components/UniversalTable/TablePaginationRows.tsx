import type { ColumnModel } from '../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface LoadPreviousRowProps {
  canLoadPrevious: boolean;
  rowsAbove: number;
  isLoadingMore: boolean;
  rowsLimit: number;
  onLoadPrevious?: () => void;
}

export const LoadPreviousRow = ({
  canLoadPrevious,
  rowsAbove,
  isLoadingMore,
  rowsLimit,
  onLoadPrevious,
}: LoadPreviousRowProps) => {
  const { t } = useLanguage();
  if (!canLoadPrevious || rowsAbove <= 0) return null;
  return (
    <tr className="bg-[var(--bg-secondary)]">
      <td colSpan={999} className="p-0 border-b border-[var(--border-primary)]">
        <div className="sticky left-0 w-fit">
          <button
            onClick={onLoadPrevious}
            disabled={isLoadingMore}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] transition-colors disabled:opacity-50"
          >
            {isLoadingMore ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t('tablePagination.loading')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {t('tablePagination.loadPrevious')} ({Math.min(rowsAbove, rowsLimit)})
              </>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
};

interface LoadNextRowProps {
  canLoadMore: boolean;
  rowsBelow: number;
  isLoadingMore: boolean;
  rowsLimit: number;
  totalRows: number;
  onLoadMore?: () => void;
}

export const LoadNextRow = ({
  canLoadMore,
  rowsBelow,
  isLoadingMore,
  rowsLimit,
  totalRows,
  onLoadMore,
}: LoadNextRowProps) => {
  const { t } = useLanguage();
  if (!canLoadMore || rowsBelow <= 0) return null;
  return (
    <tr className="bg-[var(--bg-secondary)]">
      <td colSpan={999} className="p-0 border-t border-[var(--border-primary)]">
        <div className="sticky left-0 w-fit">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] transition-colors disabled:opacity-50"
          >
            {isLoadingMore ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t('tablePagination.loading')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {t('tablePagination.loadNext')} ({Math.min(rowsBelow, rowsLimit)} / {totalRows})
              </>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
};

interface LoadingSkeletonRowsProps {
  isLoadingMore: boolean;
  columns: ColumnModel[];
  hasActionsColumn: boolean;
}

export const LoadingSkeletonRows = ({
  isLoadingMore,
  columns,
  hasActionsColumn,
}: LoadingSkeletonRowsProps) => {
  if (!isLoadingMore) return null;
  return (
    <>
      {[1, 2, 3].map((i) => (
        <tr key={`loading-${i}`} className="border-b border-[var(--border-secondary)] animate-pulse">
          {columns.map((col) => (
            <td
              key={`loading-${i}-${col.id}`}
              className="border-r border-[var(--border-primary)] px-4 py-3"
            >
              <div className="h-4 bg-[var(--bg-tertiary)] rounded w-3/4" />
            </td>
          ))}
          {hasActionsColumn && (
            <td
              className="sticky right-0 z-20 backdrop-blur-xl bg-white/80 dark:bg-gray-900/60 px-2 py-2 border-l border-[var(--border-primary)]"
              style={{ boxShadow: 'inset 1px 0 0 0 rgba(255, 255, 255, 0.3)' }}
            />
          )}
        </tr>
      ))}
    </>
  );
};
