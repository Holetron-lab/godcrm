interface ColumnLockIconProps {
  isLocked?: boolean;
  isPrimaryKey?: boolean;
  isFromSource?: boolean;
  className?: string;
}

export function ColumnLockIcon({ 
  isLocked, 
  isPrimaryKey, 
  isFromSource,
  className = '' 
}: ColumnLockIconProps) {
  if (!isLocked && !isPrimaryKey && !isFromSource) {
    return null;
  }

  if (isPrimaryKey) {
    return (
      <span 
        className={`text-primary-500 dark:text-primary-400 ${className}`}
        title="Primary key from external database"
      >
        🔑
      </span>
    );
  }

  if (isLocked || isFromSource) {
    return (
      <span 
        className={`text-gray-400 dark:text-gray-500 ${className}`}
        title="External column (read-only)"
      >
        🔒
      </span>
    );
  }

  return null;
}
