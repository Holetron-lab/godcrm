/**
 * ADR-025: Stats Card Component
 * Displays a single metric with icon and trend
 */

import { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export interface StatsCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  trend?: number; // Positive = up, negative = down
  trendLabel?: string;
  className?: string;
}

export function StatsCard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendLabel,
  className 
}: StatsCardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4',
      className
    )}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
        {icon && (
          <div className="text-[var(--text-muted)]">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-2">
        <p className="text-2xl font-bold text-[var(--text-primary)]">{value}</p>
        {trend !== undefined && (
          <div className="mt-1 flex items-center gap-1">
            <span className={cn(
              'text-xs font-medium',
              trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-[var(--text-muted)]'
            )}>
              {trend > 0 ? '↑' : trend < 0 ? '↓' : '−'} {Math.abs(trend)}%
            </span>
            {trendLabel && (
              <span className="text-xs text-[var(--text-muted)]">{trendLabel}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
