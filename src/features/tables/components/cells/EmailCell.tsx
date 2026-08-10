interface EmailCellProps {
  value: unknown;
  rawMode?: boolean;
}

export const EmailCell = ({ value, rawMode }: EmailCellProps) => {
  // RAW mode - show email as-is
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

  // Formatted mode (default)
  if (value === null || value === undefined || value === '') {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }
  
  return (
    <a
      href={`mailto:${value}`}
      className="text-sm text-[var(--color-primary-500)] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {String(value)}
    </a>
  );
};
