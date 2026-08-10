/**
 * ADR-028: Color Cell Component
 * Displays color value as a colored square/circle or emoji
 * 
 * Display modes:
 * - swatch-code: [■] #ef4444 (default)
 * - full-cell: color fills entire cell
 * - swatch-only: just the colored square
 */

import { isValidHex, isValidEmoji, getDisplayValue } from '../../utils/color-utils';
import type { ColorColumnConfig, ColorValue } from '../../types/table.types';

interface ColorCellProps {
  value: unknown;
  config?: ColorColumnConfig;
  rawMode?: boolean;
}

/**
 * Get display mode from config (with backwards compatibility)
 */
function getDisplayMode(config?: ColorColumnConfig): 'swatch-code' | 'full-cell' | 'swatch-only' {
  return config?.displayMode || 'swatch-code';
}

/**
 * Check if code should be shown
 */
function shouldShowCode(config?: ColorColumnConfig): boolean {
  // New field takes priority
  if (config?.showCode !== undefined) {
    return config.showCode;
  }
  // Default: show code in swatch-code mode
  return getDisplayMode(config) === 'swatch-code';
}

/**
 * Format color code based on codeFormat setting
 */
function formatColorCode(
  value: ColorValue, 
  hexValue: string, 
  config?: ColorColumnConfig
): string {
  const format = config?.codeFormat || 'auto';
  
  // For ColorValueObject, try to get original format
  if (typeof value === 'object' && value !== null) {
    if (format === 'auto' || format === 'name') {
      if (value.name) return value.name;
    }
    if (format === 'auto' && value.original) {
      if (value.original.ral) return value.original.ral;
      if (value.original.pantone) return value.original.pantone;
      if (value.original.cmyk) {
        const { c, m, y, k } = value.original.cmyk;
        return `${c}/${m}/${y}/${k}`;
      }
    }
    if (format === 'cmyk' && value.original?.cmyk) {
      const { c, m, y, k } = value.original.cmyk;
      return `C${c} M${m} Y${y} K${k}`;
    }
  }
  
  // Format based on setting
  switch (format) {
    case 'rgb': {
      const r = parseInt(hexValue.slice(1, 3), 16);
      const g = parseInt(hexValue.slice(3, 5), 16);
      const b = parseInt(hexValue.slice(5, 7), 16);
      return `${r}, ${g}, ${b}`;
    }
    case 'hex':
    case 'auto':
    default:
      return hexValue;
  }
}

/**
 * Render color cell based on value type and display mode
 */
export const ColorCell = ({ value, config, rawMode }: ColorCellProps) => {
  // RAW mode - show raw value without styling
  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
      </span>
    );
  }

  // Empty state
  if (value === null || value === undefined || value === '') {
    return (
      <span className="text-[var(--text-tertiary)] italic text-sm flex items-center gap-1">
        <span className="w-4 h-4 rounded border border-dashed border-[var(--border-primary)]" />
        <span className="opacity-50">—</span>
      </span>
    );
  }

  // Parse value
  const displayValue = getDisplayValue(value as ColorValue);
  const displayMode = getDisplayMode(config);
  const showCode = shouldShowCode(config);
  
  // Check if it's an emoji
  if (isValidEmoji(displayValue)) {
    return (
      <span className="text-lg leading-none" title={displayValue}>
        {displayValue}
      </span>
    );
  }

  // Check if it's a valid HEX color
  if (isValidHex(displayValue)) {
    const colorCode = formatColorCode(value as ColorValue, displayValue, config);
    
    // Full cell mode - color fills the cell
    if (displayMode === 'full-cell') {
      return (
        <span 
          className="block w-full h-6 rounded shadow-sm border border-black/10"
          style={{ backgroundColor: displayValue }}
          title={colorCode}
        />
      );
    }
    
    // Swatch only mode - just the square
    if (displayMode === 'swatch-only') {
      return (
        <span
          className="w-5 h-5 rounded shadow-sm border border-black/10 inline-block"
          style={{ backgroundColor: displayValue }}
          title={colorCode}
        />
      );
    }
    
    // Default: swatch-code mode
    return (
      <span className="inline-flex items-center gap-1.5" title={displayValue}>
        {/* Color square */}
        <span
          className="w-5 h-5 rounded shadow-sm border border-black/10 flex-shrink-0"
          style={{ backgroundColor: displayValue }}
        />
        {/* Show code if enabled */}
        {showCode && (
          <span className="text-xs text-[var(--text-secondary)] font-mono">
            {colorCode}
          </span>
        )}
      </span>
    );
  }

  // Unknown format - just show as text
  return (
    <span className="text-xs text-[var(--text-secondary)]">
      {String(displayValue)}
    </span>
  );
};
