import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { CheckIcon } from '@radix-ui/react-icons';
import { cn } from '@/shared/utils/cn';

export interface CheckboxProps extends RadixCheckbox.CheckboxProps {
  label?: string;
  description?: string;
}

export const Checkbox = ({ label, description, className, ...props }: CheckboxProps) => {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--text-primary)]">
      <RadixCheckbox.Root
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] data-[state=checked]:border-[var(--accent-primary)] data-[state=checked]:bg-[var(--accent-primary)]',
          className
        )}
        {...props}
      >
        <RadixCheckbox.Indicator className="text-white">
          <CheckIcon className="h-4 w-4" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span>
        {label}
        {description && <p className="text-xs text-[var(--text-secondary)]">{description}</p>}
      </span>
    </label>
  );
};
