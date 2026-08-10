import { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';
import { cn } from '@/shared/utils/cn';

const sizeClassMap: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-[570px]',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  full: 'max-w-[95vw]'
};

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
}

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  primaryAction?: ModalAction;
  secondaryAction?: ModalAction;
  fixedHeight?: boolean;  // NEW: Use fixed height instead of max-h
  heightOffset?: number;  // NEW: Offset from viewport height (default: 300)
  className?: string;     // Custom CSS class
}

export const Modal = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  footer,
  primaryAction,
  secondaryAction,
  fixedHeight = false,
  heightOffset = 300,
  className
}: ModalProps) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl focus:outline-none',
            // Mobile: full screen
            'max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:p-4',
            // Desktop: fixed or default padding
            fixedHeight ? 'sm:p-6 flex flex-col' : 'p-6',
            sizeClassMap[size]
          )}
          style={fixedHeight ? {
            height: `calc(100vh - ${heightOffset}px)`,
            maxHeight: `calc(100vh - ${heightOffset}px)`
          } : undefined}
        >
          {/* Header */}
          <div className="space-y-2 flex-shrink-0">
            {title ? (
              <Dialog.Title className="text-2xl font-semibold text-[var(--text-primary)]">
                {title}
              </Dialog.Title>
            ) : (
              <Dialog.Title className="sr-only">Modal</Dialog.Title>
            )}
            {description ? (
              <Dialog.Description className="text-sm text-[var(--text-secondary)]">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">Workspace modal content</Dialog.Description>
            )}
          </div>
          
          {/* Scrollable content */}
          <div className={cn(
            "mt-4 overflow-y-auto pr-2 text-[var(--text-primary)]",
            fixedHeight 
              ? "flex-1 min-h-0"  // Takes remaining space
              : "max-h-[70vh]"    // Original behavior
          )}>
            {children}
          </div>
          
          {/* Footer - fixed at bottom */}
          {(footer || primaryAction || secondaryAction) && (
            <div className="mt-4 flex-shrink-0 flex flex-col gap-2 border-t border-[var(--border-secondary)] pt-4 sm:flex-row sm:items-center sm:justify-end">
              {footer}
              <div className="flex flex-col gap-2 sm:flex-row">
                {secondaryAction && (
                  <Button
                    type="button"
                    variant={secondaryAction.variant ?? 'secondary'}
                    onClick={secondaryAction.onClick}
                  >
                    {secondaryAction.label}
                  </Button>
                )}
                {primaryAction && (
                  <Button type="button" variant={primaryAction.variant ?? 'primary'} onClick={primaryAction.onClick}>
                    {primaryAction.label}
                  </Button>
                )}
              </div>
            </div>
          )}
          <Dialog.Close asChild>
            <button
              aria-label="Close"
              className="absolute right-4 top-4 rounded-full p-2 text-[var(--text-tertiary)] transition hover:bg-[var(--bg-secondary)]"
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
