import {
  bddStatusIcon,
  bddStateBadge,
  bddPriorityBadge,
  isVerified,
} from '@/components/bdd/bdd-status-helpers';
import { cn } from '@/shared/utils/cn';

interface TaskItem {
  id: string;
  data: Record<string, unknown>;
}

interface BddTaskRowProps {
  item: TaskItem;
  codeCol: string;
  priorityCol: string;
  statusCol: string;
  titleCol: string;
  onDoubleClick?: (tab?: 'details' | 'files' | 'comments') => void;
}

export function BddTaskRow({ item, codeCol, priorityCol, statusCol, titleCol, onDoubleClick }: BddTaskRowProps) {
  const rowData = item.data || item;
  const code = rowData[codeCol];
  const priority = rowData[priorityCol];
  const status = rowData[statusCol];
  const title = rowData[titleCol];
  const pb = bddPriorityBadge(priority as string | null | undefined);
  const sb = bddStateBadge(status as string | null | undefined);
  const verified = isVerified(status as string | null | undefined);

  return (
    <button
      type="button"
      onClick={() => onDoubleClick?.('details')}
      className={cn(
        'group w-full flex items-center gap-2 text-left text-sm rounded-lg px-2 py-1.5 transition-colors',
        'bg-[var(--bg-primary)] border border-[var(--border-primary)]',
        'hover:bg-[var(--bg-secondary)] cursor-pointer',
      )}
      title={String(title || code || '')}
    >
      <span className="flex-shrink-0">{bddStatusIcon(status as string | null | undefined)}</span>
      <span className="font-mono text-xs text-[var(--text-tertiary)] flex-shrink-0 w-16 truncate">
        {code ? String(code) : `#${item.id}`}
      </span>
      {pb && (
        <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide', pb.cls)}>
          {pb.label}
        </span>
      )}
      <span className={cn('flex-1 truncate', verified && 'line-through text-[var(--text-tertiary)]')}>
        {title ? String(title) : '—'}
      </span>
      <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide', sb.cls)}>
        {sb.label}
      </span>
    </button>
  );
}
