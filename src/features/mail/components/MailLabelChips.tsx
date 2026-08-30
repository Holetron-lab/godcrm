import { cn } from '@/shared/utils/cn';
import type { MailLabelRef } from '../types';
import { hexToRgba } from '../utils/labelColor';

export interface MailLabelChipsProps {
  /** The message's labels (`MailMessage.labels`); renders nothing when empty. */
  labels?: MailLabelRef[];
  className?: string;
}

/**
 * ADR-158 §P4 — inline label chips for a message row / reader header. Each chip
 * is tinted with the label's colour (faint fill + coloured text/border); an
 * uncoloured label falls back to the neutral border token. Purely presentational
 * — tagging/untagging lives in the row/reader actions.
 */
export function MailLabelChips({ labels, className }: MailLabelChipsProps) {
  if (!labels || labels.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {labels.map((label) => {
        const fill = label.color ? hexToRgba(label.color, 0.14) : undefined;
        const tint = label.color ?? undefined;
        return (
          <span
            key={label.id}
            title={label.name}
            className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-[var(--border-primary)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--text-secondary)]"
            style={tint ? { color: tint, borderColor: tint, backgroundColor: fill } : undefined}
          >
            {label.icon && <span aria-hidden="true">{label.icon}</span>}
            <span className="truncate">{label.name}</span>
          </span>
        );
      })}
    </div>
  );
}
