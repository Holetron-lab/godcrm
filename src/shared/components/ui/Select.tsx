import { ReactNode, useId } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { cn } from '@/shared/utils/cn';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  icon?: ReactNode;
}

export interface SelectOptionGroup {
  label: string;
  icon?: ReactNode;
  options: SelectOption[];
}

export interface SelectProps {
  id?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Grouped options - if provided, options prop is ignored */
  groups?: SelectOptionGroup[];
  disabled?: boolean;
  error?: string;
}

const CaretDown = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 7L10 12L15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Select = ({
  id,
  label,
  placeholder = 'Select option',
  value,
  onChange,
  options,
  groups,
  disabled,
  error
}: SelectProps) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error ? `${fieldId}-error` : undefined;
  
  const renderOption = (option: SelectOption, index: number) => (
    <RadixSelect.Item
      className="flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:bg-[var(--bg-secondary)] data-[highlighted]:bg-[var(--bg-secondary)]"
      key={`${option.value}-${index}`}
      value={option.value}
    >
      {option.icon && <span className="text-[var(--text-tertiary)]">{option.icon}</span>}
      <div>
        <RadixSelect.ItemText>{option.label || option.value}</RadixSelect.ItemText>
        {option.description && (
          <p className="text-xs text-[var(--text-secondary)]">{option.description}</p>
        )}
      </div>
    </RadixSelect.Item>
  );
  
  return (
    <div className="flex w-full flex-col gap-1 text-sm text-[var(--text-secondary)]">
      {label && (
        <label className="font-medium text-[var(--text-secondary)]" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
        <RadixSelect.Trigger
          id={fieldId}
          aria-label={label}
          aria-describedby={describedBy}
          className={cn(
            'inline-flex items-center justify-between gap-2 rounded-md border bg-[var(--bg-primary)] px-3 py-2 text-left text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]',
            error ? 'border-[var(--color-error)]' : 'border-[var(--border-primary)]'
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>
            <CaretDown />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="z-[99999] overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg max-h-[400px]">
            <RadixSelect.Viewport className="p-1">
              {groups ? (
                // Render grouped options
                <>
                  {groups.map((group, groupIndex) => (
                    <RadixSelect.Group key={`group-${groupIndex}`}>
                      <RadixSelect.Label className="px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider flex items-center gap-2 bg-[var(--bg-secondary)]/50 sticky top-0">
                        {group.icon && <span>{group.icon}</span>}
                        {group.label}
                      </RadixSelect.Label>
                      {group.options.filter(opt => opt && opt.value != null && opt.value !== '').map((option, index) => 
                        renderOption(option, index)
                      )}
                    </RadixSelect.Group>
                  ))}
                </>
              ) : (
                // Render flat options
                options.filter(option => option && option.value != null && option.value !== '').map((option, index) => 
                  renderOption(option, index)
                )
              )}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {error && (
        <span id={`${fieldId}-error`} className="text-xs text-[var(--color-error)]">
          {error}
        </span>
      )}
    </div>
  );
};
