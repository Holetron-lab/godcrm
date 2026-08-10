import type { PaginationInfo } from '../UniversalTable/UniversalTable';

interface PaginationControlsProps {
  paginationInfo: PaginationInfo;
  rowsLimit: number;
  onRowsLimitChange?: (limit: number) => void;
  onPageChange?: (page: number) => void;
}

export const PaginationControls = ({
  paginationInfo,
  rowsLimit,
  onRowsLimitChange,
  onPageChange,
}: PaginationControlsProps) => {
  return (
    <div className="flex items-center gap-3 text-sm whitespace-nowrap">
      {/* Rows per page selector */}
      <div className="flex items-center gap-2">
        <select
          value={rowsLimit}
          onChange={(e) => onRowsLimitChange?.(Number(e.target.value))}
          className="px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm cursor-pointer hover:border-[var(--color-primary-400)] transition-colors"
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <span className="text-[var(--text-tertiary)]">строк</span>
      </div>

      {/* Page selector - only show if multiple pages */}
      {paginationInfo.totalPages > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-tertiary)]">·</span>
          <span className="text-[var(--text-tertiary)]">стр.</span>
          <select
            value={paginationInfo.currentPage}
            onChange={(e) => onPageChange?.(Number(e.target.value))}
            className="px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm cursor-pointer hover:border-[var(--color-primary-400)] transition-colors"
          >
            {Array.from({ length: paginationInfo.totalPages }, (_, i) => i + 1).map(page => (
              <option key={page} value={page}>{page}</option>
            ))}
          </select>
          <span className="text-[var(--text-tertiary)]">/</span>
          <span className="text-[var(--text-primary)] font-medium">{paginationInfo.totalPages}</span>
        </div>
      )}
    </div>
  );
};
