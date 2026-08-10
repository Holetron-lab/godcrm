/**
 * ToolbarButton Component
 * Extracted from AIChatPanel.tsx
 */

import { cn } from '@/shared/utils/cn';
import { ToolbarButtonProps } from '../../types';

export function ToolbarButton({ 
  icon, 
  label, 
  active, 
  onClick,
  badge,
  badgeColor
}: ToolbarButtonProps) {
  const badgeColorClass = badgeColor === 'red' 
    ? 'bg-red-500' 
    : badgeColor === 'green' 
    ? 'bg-green-500' 
    : 'bg-[var(--color-primary-500)]';
    
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "relative p-2 rounded-lg transition-colors",
        active
          ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
      )}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className={cn(
          "absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-bold rounded-full text-white flex items-center justify-center",
          badgeColorClass
        )}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}