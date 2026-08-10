import { useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

interface PasswordCellProps {
  value: unknown;
  rawMode?: boolean;
  showActions?: boolean;
}

export const PasswordCell = ({ value, rawMode, showActions = true }: PasswordCellProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const stringValue = value !== null && value !== undefined ? String(value) : '';
  const hasValue = stringValue.length > 0;

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasValue) return;
    
    try {
      await navigator.clipboard.writeText(stringValue);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  }, [stringValue, hasValue]);

  const handleToggleVisibility = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsVisible(prev => !prev);
    // Auto-hide after 5 seconds
    if (!isVisible) {
      setTimeout(() => setIsVisible(false), 5000);
    }
  }, [isVisible]);

  // RAW mode - still hide password but show NULL
  if (rawMode) {
    if (!hasValue) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        ••••••••
      </span>
    );
  }

  // Formatted mode (default)
  if (!hasValue) {
    return (
      <span className="text-sm text-[var(--text-tertiary)] flex items-center gap-1">
        <span className="opacity-50">🔓</span> Not set
      </span>
    );
  }

  // Calculate password strength indicator
  const getStrengthColor = () => {
    const len = stringValue.length;
    if (len < 8) return 'bg-red-500';
    if (len < 12) return 'bg-yellow-500';
    return 'bg-green-500';
  };
  
  return (
    <div className="flex items-center gap-1.5 group">
      {/* Password display */}
      <div className="flex-1 min-w-0">
        {isVisible ? (
          <span className="text-sm font-mono text-[var(--text-primary)] break-all">
            {stringValue}
          </span>
        ) : (
          <span className="text-sm font-mono text-[var(--text-secondary)] flex items-center gap-1">
            <span>••••••••</span>
            {/* Strength indicator dot */}
            <span className={`w-1.5 h-1.5 rounded-full ${getStrengthColor()}`} title={`${stringValue.length} characters`} />
          </span>
        )}
      </div>
      
      {/* Actions - show on hover */}
      {showActions && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Toggle visibility */}
          <span
            role="button"
            tabIndex={0}
            onClick={handleToggleVisibility}
            onKeyDown={(e) => e.key === 'Enter' && handleToggleVisibility(e as unknown as React.MouseEvent)}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
            title={isVisible ? 'Hide password' : 'Show password'}
          >
            {isVisible ? (
              <EyeOff className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            )}
          </span>
          
          {/* Copy button */}
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopy}
            onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
            title={isCopied ? 'Copied!' : 'Copy password'}
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            )}
          </span>
        </div>
      )}
    </div>
  );
};
