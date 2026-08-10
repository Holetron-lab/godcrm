import { useCallback, MouseEvent } from 'react';
import { cn } from '@/shared/utils/cn';
import { Check, Minus } from 'lucide-react';

interface HeaderSelectionCheckboxProps {
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  disabled?: boolean;
}

/**
 * Круглый чекбокс в заголовке таблицы для выделения всех видимых строк
 */
export const HeaderSelectionCheckbox = ({ 
  isAllSelected, 
  isIndeterminate, 
  onSelectAll,
  onDeselectAll,
  disabled = false 
}: HeaderSelectionCheckboxProps) => {
  const handleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    
    if (isAllSelected || isIndeterminate) {
      onDeselectAll();
    } else {
      onSelectAll();
    }
  }, [isAllSelected, isIndeterminate, onSelectAll, onDeselectAll, disabled]);
  
  return (
    <div 
      className={cn(
        "flex items-center justify-center w-6 h-8 cursor-pointer select-none",
        disabled && "cursor-not-allowed"
      )}
      onClick={handleClick}
      data-testid="header-checkbox"
    >
      {/* Blur glow container - 30% larger than row checkboxes */}
      <div className={cn(
        "relative flex items-center justify-center",
        "w-5 h-5 rounded-full",
        "backdrop-blur-sm",
        (isAllSelected || isIndeterminate)
          ? "bg-[var(--color-primary-500)]/20 shadow-[0_0_8px_3px_var(--color-primary-500)]" 
          : "bg-[var(--bg-secondary)]/60 hover:bg-[var(--color-primary-500)]/10 hover:shadow-[0_0_6px_2px_var(--color-primary-400)]",
        "transition-all duration-200"
      )}>
        {/* Round checkbox */}
        <div className={cn(
          "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-150",
          (isAllSelected || isIndeterminate)
            ? "bg-[var(--color-primary-500)] border-[var(--color-primary-500)]" 
            : "border-[var(--text-tertiary)] hover:border-[var(--color-primary-400)]",
          disabled && "opacity-50"
        )}>
          {isAllSelected && (
            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          )}
          {isIndeterminate && !isAllSelected && (
            <Minus className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          )}
        </div>
      </div>
    </div>
  );
};
