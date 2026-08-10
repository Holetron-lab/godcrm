import { ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';

export interface PopoverProps {
  trigger: ReactNode;
  content: ReactNode;
  align?: RadixPopover.PopoverContentProps['align'];
  side?: RadixPopover.PopoverContentProps['side'];
  sideOffset?: number;
}

export const Popover = ({ trigger, content, align = 'center', side = 'bottom', sideOffset = 4 }: PopoverProps) => {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className="z-[100] min-w-[220px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 shadow-xl"
        >
          {content}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
};
