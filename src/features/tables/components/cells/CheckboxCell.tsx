interface CheckboxConfig {
  trueValue?: string | number | boolean;
  falseValue?: string | number | boolean;
  style?: 'checkbox' | 'toggle' | 'emoji';
  trueEmoji?: string;
  falseEmoji?: string;
}

interface CheckboxCellProps {
  value: unknown;
  config?: CheckboxConfig;
  rawMode?: boolean;
}

export const CheckboxCell = ({ value, config, rawMode }: CheckboxCellProps) => {
  // RAW mode - show 1/0 or NULL
  if (rawMode) {
    if (value === null || value === undefined) {
      return (
        <div className="flex items-center justify-center w-full">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center w-full">
        <span className="font-mono text-xs text-[var(--text-secondary)]">
          {value ? '1' : '0'}
        </span>
      </div>
    );
  }

  const trueValue = config?.trueValue ?? 1;
  const style = config?.style ?? 'checkbox';
  
  // Determine if current value is "checked"
  const isChecked = value === trueValue || 
    value === true || 
    value === 1 || 
    value === '1' || 
    value === 'true' ||
    String(value) === String(trueValue);

  // Render based on style
  if (style === 'toggle') {
    return (
      <div className="flex items-center justify-center w-full">
        <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          isChecked ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            isChecked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`} />
        </div>
      </div>
    );
  }

  if (style === 'emoji') {
    const trueEmoji = config?.trueEmoji || '✅';
    const falseEmoji = config?.falseEmoji || '⬜️';
    return (
      <div className="flex items-center justify-center w-full">
        <span className="text-lg select-none">
          {isChecked ? trueEmoji : falseEmoji}
        </span>
      </div>
    );
  }

  // Default checkbox style
  return (
    <div className="flex items-center justify-center w-full">
      <div className={`h-[18px] w-[18px] rounded border-2 flex items-center justify-center transition-all ${
        isChecked 
          ? 'bg-[var(--color-primary-500)] border-[var(--color-primary-500)]' 
          : 'border-gray-400 dark:border-gray-500 bg-transparent hover:border-gray-500 dark:hover:border-gray-400'
      }`}>
        {isChecked && (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  );
};
