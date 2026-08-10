import { useEffect, useRef } from 'react';

interface CheckboxConfig {
  trueValue?: string | number | boolean;
  falseValue?: string | number | boolean;
  style?: 'checkbox' | 'toggle' | 'emoji';
}

interface CheckboxEditorProps {
  value: unknown;
  config?: CheckboxConfig;
  onChange: (value: string) => void;
  onCommit: () => void;
}

const DEFAULT_CONFIG: CheckboxConfig = {
  trueValue: 1,
  falseValue: 0,
  style: 'checkbox'
};

export const CheckboxEditor = ({ 
  value, 
  config = DEFAULT_CONFIG,
  onChange,
  onCommit
}: CheckboxEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const trueValue = config?.trueValue ?? DEFAULT_CONFIG.trueValue;
  const falseValue = config?.falseValue ?? DEFAULT_CONFIG.falseValue;
  const style = config?.style ?? DEFAULT_CONFIG.style;
  
  // Determine if current value is "checked"
  const isChecked = value === trueValue || 
    value === true || 
    value === 1 || 
    value === '1' || 
    value === 'true' ||
    String(value) === String(trueValue);
  
  // Toggle immediately on mount
  useEffect(() => {
    const newValue = isChecked ? falseValue : trueValue;
    onChange(String(newValue));
    // Auto-commit after toggle
    const timer = setTimeout(() => {
      onCommit();
    }, 50);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Render based on style
  const renderCheckbox = () => {
    const newIsChecked = !isChecked; // Show the NEW value (toggled)
    
    switch (style) {
      case 'toggle':
        return (
          <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            newIsChecked ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              newIsChecked ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </div>
        );
      case 'emoji':
        return (
          <span className="text-xl">
            {newIsChecked ? '✅' : '⬜️'}
          </span>
        );
      case 'checkbox':
      default:
        return (
          <div className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
            newIsChecked 
              ? 'bg-[var(--color-primary-500)] border-[var(--color-primary-500)]' 
              : 'border-gray-400 dark:border-gray-500'
          }`}>
            {newIsChecked && (
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        );
    }
  };

  return (
    <div 
      ref={containerRef}
      className="flex items-center justify-center h-full w-full cursor-pointer"
    >
      {renderCheckbox()}
    </div>
  );
};
