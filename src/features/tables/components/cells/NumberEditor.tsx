import { useState, useRef, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';

interface NumberEditorProps {
  value: unknown;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number | string) => void;
  onCommit: (value?: number | string | null) => void;
  onCancel: () => void;
}

export const NumberEditor = ({
  value,
  step = 1,
  min,
  max,
  onChange,
  onCommit,
  onCancel
}: NumberEditorProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(() => {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    return String(value);
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const numValue = localValue === '' ? 0 : parseFloat(localValue);
  const isValidNumber = localValue === '' || !isNaN(numValue);

  const handleIncrement = () => {
    let newValue = (isNaN(numValue) ? 0 : numValue) + step;
    if (max !== undefined && newValue > max) newValue = max;
    const formatted = Number.isInteger(newValue) ? String(newValue) : newValue.toFixed(2);
    setLocalValue(formatted);
    onChange(parseFloat(formatted));
  };

  const handleDecrement = () => {
    let newValue = (isNaN(numValue) ? 0 : numValue) - step;
    if (min !== undefined && newValue < min) newValue = min;
    const formatted = Number.isInteger(newValue) ? String(newValue) : newValue.toFixed(2);
    setLocalValue(formatted);
    onChange(parseFloat(formatted));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    // Only update parent if it's a valid number or empty
    if (val === '' || !isNaN(parseFloat(val))) {
      onChange(val === '' ? '' : parseFloat(val));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isValidNumber) {
        // Send null for empty string to handle MySQL integer columns properly
        onCommit(localValue === '' ? null : parseFloat(localValue));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleIncrement();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleDecrement();
    }
  };

  const handleBlur = () => {
    if (isValidNumber) {
      // Send null for empty string to handle MySQL integer columns properly
      onCommit(localValue === '' ? null : parseFloat(localValue));
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex items-center h-7 border-2 border-[var(--color-primary-500)] rounded overflow-hidden">
        {/* Decrement button */}
        <button
          type="button"
          onClick={handleDecrement}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center justify-center w-7 h-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border-r border-[var(--border-primary)]"
        >
          <Minus className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`w-16 h-full px-2 text-center text-sm font-mono bg-[var(--bg-primary)] border-none outline-none ${
            !isValidNumber ? 'text-red-500' : ''
          }`}
        />

        {/* Increment button */}
        <button
          type="button"
          onClick={handleIncrement}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center justify-center w-7 h-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border-l border-[var(--border-primary)]"
        >
          <Plus className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        </button>
      </div>
    </div>
  );
};
