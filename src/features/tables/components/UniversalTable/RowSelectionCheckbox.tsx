import { useCallback, useRef, useState, MouseEvent } from 'react';
import { cn } from '@/shared/utils/cn';
import { Check, MessageCircle, MessageCirclePlus, Paperclip, Pencil, Copy, Trash2 } from 'lucide-react';

interface RowQuickAction {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}

interface RowSelectionCheckboxProps {
  rowId: string | number;
  isSelected: boolean;
  onToggle: (rowId: string | number) => void;
  disabled?: boolean;
  /** Quick actions shown as icon bar on hover below/above the checkbox */
  quickActions?: RowQuickAction[];
  /** Where to show quick actions: 'below' for top rows, 'above' for others */
  quickActionsPosition?: 'above' | 'below';
}

/** Delay before showing quick actions (ms) */
const SHOW_DELAY = 500;

/**
 * Круглый чекбокс для выделения строки в таблице.
 * При наведении (после 0.5с задержки) снизу/сверху появляется мини-тулбар.
 * Быстрые клики по чекбоксу не вызывают меню.
 */
export const RowSelectionCheckbox = ({
  rowId,
  isSelected,
  onToggle,
  disabled = false,
  quickActions,
  quickActionsPosition = 'above'
}: RowSelectionCheckboxProps) => {
  const [showActions, setShowActions] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onToggle(rowId);
    }
  }, [rowId, onToggle, disabled]);

  const handleMouseEnter = useCallback(() => {
    if (!quickActions?.length) return;
    timerRef.current = setTimeout(() => setShowActions(true), SHOW_DELAY);
  }, [quickActions]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowActions(false);
  }, []);

  const hasActions = quickActions && quickActions.length > 0;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center w-5 h-8 cursor-pointer select-none",
        disabled && "cursor-not-allowed"
      )}
      data-testid={`row-checkbox-${rowId}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Checkbox — always visible */}
      <div className="flex items-center justify-center" onClick={handleClick}>
        {/* Blur glow container */}
        <div className={cn(
          "relative flex items-center justify-center",
          "w-4 h-4 rounded-full",
          "backdrop-blur-sm",
          isSelected
            ? "bg-[var(--color-primary-500)]/20 shadow-[0_0_6px_2px_var(--color-primary-500)]"
            : "bg-[var(--bg-primary)]/60 hover:bg-[var(--color-primary-500)]/10 hover:shadow-[0_0_4px_1px_var(--color-primary-400)]",
          "transition-all duration-200"
        )}>
          {/* Round checkbox */}
          <div className={cn(
            "w-3 h-3 rounded-full border-[1.5px] flex items-center justify-center transition-all duration-150",
            isSelected
              ? "bg-[var(--color-primary-500)] border-[var(--color-primary-500)]"
              : "border-[var(--text-tertiary)] hover:border-[var(--color-primary-400)]",
            disabled && "opacity-50"
          )}>
            {isSelected && (
              <Check className="w-2 h-2 text-white" strokeWidth={3} />
            )}
          </div>
        </div>
      </div>

      {/* Quick action icons — appear after delay, above or below the checkbox */}
      {hasActions && showActions && (
        <div
          className={cn(
            "absolute left-0 flex items-center gap-0 z-30",
            "rounded-md bg-[var(--bg-secondary)]/95 backdrop-blur-sm border border-[var(--border-primary)] shadow-lg px-0.5 py-0.5",
            "animate-in fade-in duration-150",
            quickActionsPosition === 'below'
              ? "top-[calc(100%-2px)]"
              : "bottom-[calc(100%-2px)]"
          )}
        >
          {quickActions!.map((action, idx) => (
            <button
              key={idx}
              type="button"
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-colors",
                action.danger
                  ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  : "text-[var(--text-secondary)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10"
              )}
              title={action.title}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Helper to build quick actions array from callbacks
export function buildRowQuickActions(opts: {
  onOpenChat?: () => void;
  onAttachToChat?: () => void;
  onAttachToMessage?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}): RowQuickAction[] {
  const actions: RowQuickAction[] = [];
  if (opts.onOpenChat) {
    actions.push({ icon: <MessageCircle className="w-3.5 h-3.5" />, onClick: opts.onOpenChat, title: 'Chat' });
  }
  if (opts.onAttachToChat) {
    actions.push({ icon: <MessageCirclePlus className="w-3.5 h-3.5" />, onClick: opts.onAttachToChat, title: 'Attach to chat' });
  }
  if (opts.onAttachToMessage) {
    actions.push({ icon: <Paperclip className="w-3.5 h-3.5" />, onClick: opts.onAttachToMessage, title: 'Attach to message' });
  }
  if (opts.onEdit) {
    actions.push({ icon: <Pencil className="w-3.5 h-3.5" />, onClick: opts.onEdit, title: 'Edit' });
  }
  if (opts.onDuplicate) {
    actions.push({ icon: <Copy className="w-3.5 h-3.5" />, onClick: opts.onDuplicate, title: 'Duplicate' });
  }
  if (opts.onDelete) {
    actions.push({ icon: <Trash2 className="w-3.5 h-3.5" />, onClick: opts.onDelete, title: 'Delete', danger: true });
  }
  return actions;
}
