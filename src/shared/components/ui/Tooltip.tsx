import { ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
  align?: RadixTooltip.TooltipContentProps['align'];
}

export const Tooltip = ({ label, children, side = 'top', align = 'center' }: TooltipProps) => {
  return (
    <RadixTooltip.Provider delayDuration={200} skipDelayDuration={0} disableHoverableContent={false}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={5}
            className="z-[9999] rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white shadow-lg animate-in fade-in-0 zoom-in-95"
          >
            {label}
            <RadixTooltip.Arrow className="fill-black/80" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
};
