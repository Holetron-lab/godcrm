import { Link2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MailLinkPopover } from './MailLinkPopover';
import { useLinkedRowLabel } from '../hooks/useMailLink';
import type { MailMessage } from '../types';

export interface MailLinkBarProps {
  spaceId: number | undefined;
  message: MailMessage;
}

/**
 * ADR-158 §P2 — reader link bar. Rendered inline in `MailReadToolbar` (its
 * `linkSlot`, sibling of the label bar). Shows the linked CRM record as a chip
 * (click to change/unlink) or a dashed "＋ Привязать" affordance when unlinked —
 * mirroring `MailLabelBar`.
 */
export function MailLinkBar({ spaceId, message }: MailLinkBarProps) {
  const linkedLabel = useLinkedRowLabel(message);
  const isLinked = message.linkedRowId != null;

  const trigger = (
    <button
      type="button"
      title={isLinked ? 'Изменить привязку к записи' : 'Привязать к записи CRM'}
      className={cn(
        'inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
        isLinked
          ? 'border-[var(--color-primary-600)] text-[var(--color-primary-600)]'
          : 'border-dashed border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
      )}
    >
      <Link2 size={12} className="flex-shrink-0" />
      <span className="truncate">{isLinked ? linkedLabel ?? 'Запись' : 'Привязать'}</span>
    </button>
  );

  return <MailLinkPopover spaceId={spaceId} message={message} trigger={trigger} />;
}
