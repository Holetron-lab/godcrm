import { Star } from 'lucide-react';
import type { NumberColumnConfig } from '../../types/table.types';

interface NumberCellProps {
  value: unknown;
  rawMode?: boolean;
  config?: NumberColumnConfig;
  rowData?: Record<string, unknown>; // Row data for column references
}

export const NumberCell = ({ 
  value, 
  rawMode,
  config,
  rowData
}: NumberCellProps) => {
  // Parse value to number
  const numValue = value === null || value === undefined || value === '' 
    ? null 
    : Number(value);
  
  const displayValue = numValue !== null && !isNaN(numValue) ? numValue : null;

  // Helper to get value from config or column
  const getConfigValue = <T,>(
    fixedValue: T | undefined, 
    columnName: string | undefined, 
    defaultValue: T
  ): T => {
    if (columnName && rowData) {
      const colValue = rowData[columnName];
      if (colValue !== null && colValue !== undefined) {
        return colValue as T;
      }
    }
    return fixedValue ?? defaultValue;
  };

  // Config values with column support
  const displayStyle = config?.displayStyle ?? 'default';
  const prefix = getConfigValue(config?.prefix, config?.prefixColumn, '');
  const suffix = getConfigValue(config?.suffix, config?.suffixColumn, '');
  const decimals = config?.decimals;
  const thousandsSeparator = config?.thousandsSeparator ?? false;
  
  // For progress, get max from column if configured
  const progressMax = config?.maxType === 'column' && config?.maxColumn 
    ? Number(getConfigValue(undefined, config.maxColumn, 100)) || 100
    : (config?.progressMax ?? config?.max ?? 100);
  
  const progressColor = config?.progressColor ?? '#22c55e';
  const badgeColor = config?.badgeColor ?? '#3b82f6';
  const ratingMax = config?.ratingMax ?? 5;

  // Format number for display
  const formatNumber = (num: number | null): string => {
    if (num === null) return '—';
    
    let formatted: string;
    
    if (decimals !== undefined) {
      formatted = num.toFixed(decimals);
    } else {
      formatted = String(num);
    }
    
    if (thousandsSeparator) {
      const parts = formatted.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      formatted = parts.join('.');
    }
    
    return `${prefix}${formatted}${suffix}`;
  };

  // Compact format (1K, 1M)
  const formatCompact = (num: number | null): string => {
    if (num === null) return '—';
    if (Math.abs(num) >= 1000000) return `${prefix}${(num / 1000000).toFixed(1)}M${suffix}`;
    if (Math.abs(num) >= 1000) return `${prefix}${(num / 1000).toFixed(1)}K${suffix}`;
    return `${prefix}${num}${suffix}`;
  };

  // RAW mode - show raw number value
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  // Progress calculations
  const progressPercent = displayValue !== null ? Math.min(100, Math.max(0, (displayValue / progressMax) * 100)) : 0;
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Rating display
  if (displayStyle === 'rating') {
    const stars = Array.from({ length: ratingMax }, (_, i) => i + 1);
    return (
      <div className="flex items-center gap-0.5">
        {stars.map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              displayValue !== null && star <= displayValue
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-transparent text-[var(--text-tertiary)]'
            }`}
          />
        ))}
      </div>
    );
  }

  // Slider display
  if (displayStyle === 'slider') {
    const min = config?.min ?? 0;
    const max = config?.max ?? 100;
    const sliderPercent = displayValue !== null 
      ? ((displayValue - min) / (max - min)) * 100 
      : 0;
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all"
            style={{ 
              width: `${sliderPercent}%`,
              backgroundColor: progressColor
            }}
          />
        </div>
        <span className="text-xs font-mono text-[var(--text-secondary)] min-w-[24px] text-right">
          {displayValue ?? 0}
        </span>
      </div>
    );
  }

  // Progress bar display
  if (displayStyle === 'progress') {
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all"
            style={{ 
              width: `${progressPercent}%`,
              backgroundColor: progressColor
            }}
          />
        </div>
        <span className="text-xs font-mono text-[var(--text-secondary)] min-w-[24px] text-right">
          {displayValue ?? 0}
        </span>
      </div>
    );
  }

  // Progress vertical display
  if (displayStyle === 'progress-vertical') {
    return (
      <div className="flex items-end justify-center gap-1 h-8">
        <div className="w-4 h-full bg-[var(--bg-tertiary)] rounded-sm overflow-hidden flex flex-col justify-end">
          <div 
            className="w-full rounded-sm transition-all"
            style={{ 
              height: `${progressPercent}%`,
              backgroundColor: progressColor
            }}
          />
        </div>
        <span className="text-xs font-mono text-[var(--text-secondary)]">
          {displayValue ?? 0}
        </span>
      </div>
    );
  }

  // Progress ring display
  if (displayStyle === 'progress-ring') {
    return (
      <div className="flex items-center justify-center gap-2">
        <svg width="28" height="28" className="transform -rotate-90 shrink-0">
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke="var(--bg-tertiary)"
            strokeWidth="3"
          />
          <circle
            cx="14"
            cy="14"
            r={radius}
            fill="none"
            stroke={progressColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-300"
          />
        </svg>
        <span className="text-xs font-mono text-[var(--text-secondary)]">
          {displayValue ?? 0}
        </span>
      </div>
    );
  }

  // Badge display
  if (displayStyle === 'badge') {
    return (
      <span 
        className="px-2 py-0.5 text-xs font-medium rounded-full text-white"
        style={{ backgroundColor: badgeColor }}
      >
        {formatNumber(displayValue)}
      </span>
    );
  }

  // Currency display
  if (displayStyle === 'currency') {
    return (
      <span className="text-sm font-mono text-[var(--text-primary)]">
        {formatNumber(displayValue)}
      </span>
    );
  }

  // Percent display
  if (displayStyle === 'percent') {
    const percentSuffix = suffix || '%';
    return (
      <span className="text-sm font-mono text-[var(--text-primary)]">
        {displayValue !== null ? `${prefix}${displayValue}${percentSuffix}` : '—'}
      </span>
    );
  }

  // Compact display
  if (displayStyle === 'compact') {
    return (
      <span className="text-sm font-mono text-[var(--text-primary)]">
        {formatCompact(displayValue)}
      </span>
    );
  }

  // Default display
  return (
    <span className="text-sm font-mono text-[var(--text-primary)]">
      {displayValue !== null ? formatNumber(displayValue) : '—'}
    </span>
  );
};
