import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';
import { cn } from '@/shared/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, leftAddon, rightAddon, className, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

    return (
      <div className="flex w-full flex-col gap-1 text-sm text-[var(--text-secondary)]">
        {label && (
          <label htmlFor={inputId} className="font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border bg-[var(--bg-primary)] px-3 py-2 focus-within:border-[var(--color-primary-500)] focus-within:ring-1 focus-within:ring-[var(--color-primary-500)]',
            error ? 'border-[var(--color-error)]' : 'border-[var(--border-primary)]'
          )}
        >
          {leftAddon && <span className="text-[var(--text-tertiary)]">{leftAddon}</span>}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full border-none bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]',
              className
            )}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            {...props}
          />
          {rightAddon && <span className="text-[var(--text-tertiary)]">{rightAddon}</span>}
        </div>
        {hint && !error && (
          <span id={`${inputId}-hint`} className="text-xs text-[var(--text-tertiary)]">
            {hint}
          </span>
        )}
        {error && (
          <span id={`${inputId}-error`} className="text-xs text-[var(--color-error)]">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
