import type { Table as ReactTable } from '@tanstack/react-table';
import type { RowModel, ColumnModel } from '../../types/table.types';

interface TableGridFooterProps {
  table: ReactTable<RowModel>;
  columnSummaries: Map<string, React.ReactNode>;
  hiddenColumns: ColumnModel[];
  showHiddenTemporarily: boolean;
  groupByColumn: string | null;
  onToggleRowSelection?: (rowId: string | number) => void;
  hasActionsColumn: boolean;
}

export const TableGridFooter = ({
  table,
  columnSummaries,
  hiddenColumns,
  showHiddenTemporarily,
  groupByColumn,
  onToggleRowSelection,
  hasActionsColumn,
}: TableGridFooterProps) => {
  return (
    <tfoot className="bg-[var(--bg-secondary)] border-t-2 border-[var(--border-primary)]">
      <tr>
        {/* Empty cell for checkbox column */}
        {onToggleRowSelection && (
          <td className="w-7 border-r border-[var(--border-primary)]" />
        )}
        {table
          .getHeaderGroups()[0]
          ?.headers.filter(header => !groupByColumn || header.id !== groupByColumn)
          .map((header, index) => {
            const summary = columnSummaries.get(header.id);
            return (
              <td
                key={`summary-${header.id}`}
                className={`border-r border-[var(--border-primary)] px-4 py-2 text-xs ${
                  index === 0 && !onToggleRowSelection
                    ? 'rounded-bl-2xl border-l border-l-[var(--border-primary)]'
                    : ''
                }`}
                style={{
                  width: header.getSize(),
                  minWidth: header.getSize(),
                  maxWidth: header.getSize(),
                }}
              >
                {summary}
              </td>
            );
          })}

        {/* Hidden columns spacer */}
        {hiddenColumns.length > 0 && !showHiddenTemporarily && (
          <td className="w-[50px] bg-amber-50/20 dark:bg-amber-950/10 border-l border-[var(--border-primary)]" />
        )}
        {hiddenColumns.length > 0 && showHiddenTemporarily && (
          <>
            <td className="w-[50px] bg-amber-100/50 dark:bg-amber-900/30 border-l border-[var(--border-primary)]" />
            {hiddenColumns.map(col => (
              <td
                key={`summary-hidden-${col.id}`}
                className="min-w-[100px] bg-amber-50/50 dark:bg-amber-950/20 border-l border-[var(--border-primary)] px-3 py-2"
              />
            ))}
          </>
        )}

        {/* Actions column spacer */}
        {hasActionsColumn && (
          <td
            className="sticky right-0 z-20 backdrop-blur-xl bg-white/80 dark:bg-gray-900/60 w-[50px] rounded-br-2xl border-l border-[var(--border-primary)]"
            style={{ boxShadow: 'inset 1px 0 0 0 rgba(255, 255, 255, 0.3)' }}
          />
        )}
      </tr>
    </tfoot>
  );
};
