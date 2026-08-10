import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/shared/utils/cn';

export interface SwitchProps extends RadixSwitch.SwitchProps {
  label?: string;
  description?: string;
}

export const Switch = ({ label, description, className, ...props }: SwitchProps) => {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm text-[var(--text-primary)]">
      <span className="space-y-1">
        {label}
        {description && <p className="text-xs text-[var(--text-secondary)]">{description}</p>}
      </span>
      <RadixSwitch.Root
        className={cn(
          'relative h-6 w-11 rounded-full bg-[var(--border-primary)] transition data-[state=checked]:bg-[var(--color-primary-600)]',
          className
        )}
        {...props}
      >
        <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition will-change-transform data-[state=checked]:translate-x-[22px]" />
      </RadixSwitch.Root>
    </label>
  );
};
