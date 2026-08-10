/**
 * RelationValue - Universal component for displaying relation field values
 * 
 * Renders a relation value as a badge with label and color.
 * Supports both single and multiple values.
 * 
 * Usage:
 *   <RelationValue value={24275} relation={relationConfig} />
 *   <RelationValue value="24275" relation={relationConfig} variant="compact" />
 */

import { useRelationLookup, parseRelationConfig, type RelationItem } from '../hooks/useRelationLookup';
import type { ColumnRelationConfig } from '../types/table.types';

interface RelationValueProps {
  /** The value (ID) to lookup */
  value: unknown;
  /** Relation config (can be raw config object or parsed) */
  relation?: ColumnRelationConfig | Record<string, unknown>;
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

export function RelationValue({ 
  value, 
  relation, 
  variant = 'default',
  fallback,
  className = ''
}: RelationValueProps) {
  // Parse relation config if needed
  const parsedRelation = relation && 'enabled' in relation 
    ? relation as ColumnRelationConfig
    : parseRelationConfig(relation);
  
  const { lookup, isLoading } = useRelationLookup(parsedRelation);
  
  // Empty value
  if (value === null || value === undefined || value === '') {
    if (fallback) {
      return <span className={`text-[var(--text-tertiary)] italic text-sm ${className}`}>{fallback}</span>;
    }
    return null;
  }
  
  // Loading state
  if (isLoading) {
    return (
      <span className={`text-[var(--text-tertiary)] text-sm ${className}`}>
        ...
      </span>
    );
  }
  
  const item = lookup(value);
  
  // Value not found in relation table
  if (!item) {
    // Show raw value as fallback
    return (
      <span className={`text-[var(--text-secondary)] text-sm ${className}`}>
        {String(value)}
      </span>
    );
  }
  
  // Render based on variant
  switch (variant) {
    case 'text':
      return (
        <span className={`text-sm text-[var(--text-primary)] ${className}`}>
          {item.label}
        </span>
      );
    
    case 'compact':
      return (
        <span 
          className={`inline-flex items-center text-xs ${className}`}
          style={{ color: item.color }}
        >
          {item.label}
        </span>
      );
    
    case 'badge':
    default:
      const bgColor = item.color ? hexToRgba(item.color, 0.15) : 'var(--bg-tertiary)';
      const textColor = item.color || 'var(--text-secondary)';
      
      return (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
          style={{
            backgroundColor: bgColor,
            color: textColor,
            border: item.color ? `1px solid ${hexToRgba(item.color, 0.3)}` : undefined
          }}
        >
          {item.label}
        </span>
      );
  }
}

/**
 * RelationValueMultiple - For multi-select relation fields
 */
interface RelationValueMultipleProps {
  values: unknown[];
  relation?: ColumnRelationConfig | Record<string, unknown>;
  variant?: 'default' | 'compact' | 'text' | 'badge';
  max?: number;
  className?: string;
}

export function RelationValueMultiple({
  values,
  relation,
  variant = 'default',
  max = 3,
  className = ''
}: RelationValueMultipleProps) {
  const displayValues = values.slice(0, max);
  const remaining = values.length - max;
  
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {displayValues.map((value, index) => (
        <RelationValue 
          key={index} 
          value={value} 
          relation={relation} 
          variant={variant}
        />
      ))}
      {remaining > 0 && (
        <span className="text-xs text-[var(--text-tertiary)]">
          +{remaining}
        </span>
      )}
    </div>
  );
}

export default RelationValue;
