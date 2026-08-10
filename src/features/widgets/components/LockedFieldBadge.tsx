/**
 * ADR-0005 C-4 — Inline 🔒 badge that marks a settings-rail field as locked
 * by the document author. Pair it with the field's <label> text:
 *
 *   <label className="...">
 *     Колонка <LockedFieldBadge />
 *   </label>
 *
 * When the surrounding panel decides a field is locked it should ALSO
 * pass `disabled` to the input — this badge is purely visual.
 */

import { Lock } from 'lucide-react';
import { LOCKED_TOOLTIP_RU } from '../utils/lockedFieldsContext';

interface LockedFieldBadgeProps {
  /** Override the default Russian tooltip if the surrounding UI is English. */
  title?: string;
  className?: string;
}

export function LockedFieldBadge({ title = LOCKED_TOOLTIP_RU, className }: LockedFieldBadgeProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      data-locked-by-author
      className={
        'inline-flex items-center justify-center align-middle ml-1 ' +
        'text-amber-500 cursor-help ' +
        (className ?? '')
      }
    >
      <Lock className="w-3 h-3" strokeWidth={2.5} />
    </span>
  );
}

export default LockedFieldBadge;
