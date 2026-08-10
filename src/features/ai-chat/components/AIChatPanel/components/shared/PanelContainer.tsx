/**
 * PanelContainer Component
 * Reusable container for all panels
 */

import { cn } from '@/shared/utils/cn';

interface PanelContainerProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  headerActions?: React.ReactNode;
}

export function PanelContainer({ 
  children, 
  className, 
  title, 
  headerActions 
}: PanelContainerProps) {
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {title && (
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <h3 className="font-medium text-[var(--text-primary)]">{title}</h3>
          {headerActions}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}