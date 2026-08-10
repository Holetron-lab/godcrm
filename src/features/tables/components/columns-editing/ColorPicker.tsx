/**
 * ColorPicker - Color selection component with preset colors and hex input
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COLUMN_COLORS } from './constants';
import type { ColorPickerProps } from './types';

export const ColorPicker = ({ value, onChange, compact = false }: ColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');

  const handleInputChange = (v: string) => {
    setInputValue(v);
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    } else if (v === '' || v === '#') {
      onChange(null);
    }
  };

  return (
    <div className="relative">
      <div className="flex">
        <div
          className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded-l-lg border border-r-0 border-[var(--border-primary)] flex items-center justify-center flex-shrink-0`}
          style={{
            backgroundColor: value || 'var(--bg-secondary)',
            backgroundImage: value ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
            backgroundSize: value ? undefined : '6px 6px'
          }}
        />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="#000000"
          className={`${compact ? 'w-16 px-1 text-xs' : 'w-20 px-2 text-sm'} ${compact ? 'h-8' : 'h-10'} border-y border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-primary-500)]`}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`${compact ? 'h-8 w-6' : 'h-10 w-8'} rounded-r-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] flex items-center justify-center`}
        >
          <ChevronDown className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-2">
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {COLUMN_COLORS.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onChange(c); setInputValue(c || ''); setIsOpen(false); }}
                className={`h-5 w-5 rounded border transition-all ${
                  value === c ? 'border-white ring-1 ring-[var(--color-primary-500)]' : 'border-transparent hover:border-white/30'
                }`}
                style={{
                  backgroundColor: c || 'var(--bg-tertiary)',
                  backgroundImage: c ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
                  backgroundSize: c ? undefined : '4px 4px'
                }}
                title={c || 'Без цвета'}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
