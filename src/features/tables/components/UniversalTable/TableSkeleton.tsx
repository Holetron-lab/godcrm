import { memo } from 'react';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export const TableSkeleton = memo(function TableSkeleton({ 
  rows = 10, 
  columns = 6 
}: TableSkeletonProps) {
  return (
    <div className="animate-pulse">
      {/* Toolbar skeleton */}
      <div className="flex items-center gap-3 p-4 border-b border-[var(--border-primary)]">
        <div className="h-9 w-64 rounded-lg bg-[var(--bg-tertiary)]" />
        <div className="h-9 w-24 rounded-lg bg-[var(--bg-tertiary)]" />
        <div className="h-9 w-24 rounded-lg bg-[var(--bg-tertiary)]" />
        <div className="ml-auto h-9 w-32 rounded-lg bg-[var(--bg-tertiary)]" />
      </div>
      
      {/* Table skeleton */}
      <div className="overflow-hidden rounded-b-2xl">
        <table className="w-full">
          {/* Header */}
          <thead className="bg-[var(--bg-secondary)]">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="border-r border-[var(--border-primary)] px-4 py-3 last:border-r-0">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded bg-[var(--bg-tertiary)]" />
                    <div className="h-4 w-20 rounded bg-[var(--bg-tertiary)]" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          
          {/* Body */}
          <tbody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr 
                key={rowIndex} 
                className="border-b border-[var(--border-secondary)] last:border-none"
              >
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <td 
                    key={colIndex} 
                    className="border-r border-[var(--border-primary)] px-4 py-3 last:border-r-0"
                  >
                    <div 
                      className="h-4 rounded bg-[var(--bg-tertiary)]"
                      style={{ 
                        width: `${40 + Math.random() * 40}%`,
                        opacity: 0.5 + Math.random() * 0.5
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Footer skeleton */}
      <div className="flex items-center justify-between p-4 border-t border-[var(--border-primary)]">
        <div className="h-4 w-32 rounded bg-[var(--bg-tertiary)]" />
        <div className="flex gap-2">
          <div className="h-8 w-20 rounded bg-[var(--bg-tertiary)]" />
          <div className="h-8 w-20 rounded bg-[var(--bg-tertiary)]" />
        </div>
      </div>
    </div>
  );
});
