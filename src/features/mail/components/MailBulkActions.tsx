import { MailOpen, Mail, Archive, Star, Tag, Check, X } from 'lucide-react';
import { Popover } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { MailLabel } from '../types';

export interface MailBulkActionsProps {
  /** How many rows are checked — drives the counter and gating. */
  count: number;
  /** Space labels for the "＋ Ярлык" popover. */
  labels: MailLabel[];
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  /** "В избранное" — stars every checked row. */
  onStar: () => void;
  /** Tag every checked row with `labelId`. */
  onTagLabel: (labelId: number) => void;
  /** Clear the checkbox selection (dismisses this bar). */
  onClear: () => void;
}

/**
 * ADR-158 — top-toolbar bulk actions. Unlike `MailReadToolbar` (which acts on the
 * one open message), every control here applies to the whole checkbox selection.
 * Rendered only when at least one row is checked (parent gates on `count`), inline
 * next to Compose — a bare flex group with no bar chrome of its own.
 */
export function MailBulkActions({
  count,
  labels,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onStar,
  onTagLabel,
  onClear,
}: MailBulkActionsProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Снять выделение"
        title="Снять выделение"
        onClick={onClear}
        className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <X size={16} />
      </button>
      <span className="mr-1 whitespace-nowrap text-xs font-medium text-[var(--text-secondary)]">
        {count} выбр.
      </span>

      <BulkButton label="Пометить прочитанными" onClick={onMarkRead}>
        <MailOpen size={16} />
      </BulkButton>
      <BulkButton label="Пометить непрочитанными" onClick={onMarkUnread}>
        <Mail size={16} />
      </BulkButton>
      <BulkButton label="В архив" onClick={onArchive}>
        <Archive size={16} />
      </BulkButton>
      <BulkButton label="В избранное" onClick={onStar}>
        <Star size={16} />
      </BulkButton>

      {labels.length > 0 && (
        <Popover
          align="end"
          trigger={
            <button
              type="button"
              aria-label="Добавить ярлык"
              title="Добавить ярлык"
              className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            >
              <Tag size={16} />
            </button>
          }
          content={
            <ul className="max-h-64 min-w-[200px] overflow-y-auto">
              {labels.map((label) => {
                const tint = label.color ?? undefined;
                return (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => onTagLabel(label.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
                    >
                      <Tag size={14} className="flex-shrink-0" style={tint ? { color: tint } : undefined} />
                      <span className="flex-1 truncate">{label.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          }
        />
      )}
    </div>
  );
}

function BulkButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors',
        'hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
      )}
    >
      {children}
    </button>
  );
}
