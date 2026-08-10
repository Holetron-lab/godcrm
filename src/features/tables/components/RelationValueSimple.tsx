/**
 * RelationValueSimple - Simple component for displaying relation field values
 * 
 * Unlike RelationValue, this component does NOT use hooks.
 * It requires pre-loaded relation data passed as props.
 * Use this in lists/maps where hooks would cause issues.
 * 
 * Usage:
 *   <RelationValueSimple value={24275} relationData={preloadedMap} />
 */

interface RelationValueSimpleProps {
  /** The value (ID) to lookup */
  value: unknown;
  /** Pre-loaded relation data map: ID -> { label, color } */
  relationData?: Map<string, { label: string; color?: string }>;
  /** Display variant */
  variant?: 'default' | 'compact' | 'text' | 'badge';
  /** Fallback text when value not found */
  fallback?: string;
  /** Additional className */
  className?: string;
}

// Helper to convert hex to rgba
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Default color palette for auto-assignment
const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

export function RelationValueSimple({ 
  value, 
  relationData,
  variant = 'default',
  fallback,
  className = ''
}: RelationValueSimpleProps) {
  // Empty value
  if (value === null || value === undefined || value === '') {
    if (fallback) {
      return <span className={`text-[var(--text-tertiary)] italic text-sm ${className}`}>{fallback}</span>;
    }
    return null;
  }
  
  // No relation data - just show raw value
  if (!relationData) {
    return <span className={`text-sm text-[var(--text-secondary)] ${className}`}>{String(value)}</span>;
  }
  
  // Lookup value
  const stringValue = String(value);
  const item = relationData.get(stringValue);
  
  if (!item) {
    // Value not found - show raw value
    return <span className={`text-sm text-[var(--text-secondary)] ${className}`}>{stringValue}</span>;
  }
  
  const { label, color } = item;
  const effectiveColor = color || getDefaultColor(hashString(label));
  
  // Render based on variant
  if (variant === 'text') {
    return <span className={`text-sm ${className}`}>{label}</span>;
  }
  
  if (variant === 'compact') {
    return (
      <span 
        className={`text-xs px-1.5 py-0.5 rounded ${className}`}
        style={{
          backgroundColor: hexToRgba(effectiveColor, 0.15),
          color: effectiveColor
        }}
      >
        {label}
      </span>
    );
  }
  
  // default / badge variant
  return (
    <span 
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm ${className}`}
      style={{
        backgroundColor: hexToRgba(effectiveColor, 0.15),
        color: effectiveColor
      }}
    >
      <span 
        className="w-2 h-2 rounded-full flex-shrink-0" 
        style={{ backgroundColor: effectiveColor }}
      />
      {label}
    </span>
  );
}
