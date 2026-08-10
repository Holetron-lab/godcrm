import { useMemo } from 'react';
import { Checkbox } from './Checkbox';
import { Popover } from './Popover';
import { Button } from './Button';

export interface MultiSelectOption {
  label: string;
  value: string;
}

export interface MultiSelectProps {
  label?: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export const MultiSelect = ({ label, value, options, onChange, placeholder = 'Select options' }: MultiSelectProps) => {
  const selectedLabel = useMemo(() => {
    if (!value.length) return placeholder;
    if (value.length === 1) {
      return options.find((option) => option.value === value[0])?.label ?? placeholder;
    }
    return `${value.length} selected`;
  }, [value, options, placeholder]);

  const toggleValue = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const clearAll = () => onChange([]);
  const selectAll = () => onChange(options.map((option) => option.value));

  return (
    <div className="flex w-full flex-col gap-1 text-sm text-[var(--text-secondary)]">
      {label && <span className="font-medium text-[var(--text-secondary)]">{label}</span>}
      <Popover
        trigger={
          <Button
            type="button"
            variant="secondary"
            className="flex w-full items-center justify-between border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
          >
            {selectedLabel}
          </Button>
        }
        content={
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} type="button">
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAll} type="button">
                Clear
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {options.map((option, index) => (
                <Checkbox
                  key={`${option.value}-${index}`}
                  checked={value.includes(option.value)}
                  onCheckedChange={() => toggleValue(option.value)}
                  label={option.label}
                />
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
};
