import { useState, type ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { MailPeoplePicker } from './MailPeoplePicker';
import type { MailMessage } from '../types';

export interface MailLinkPopoverProps {
  spaceId: number | undefined;
  message: MailMessage;
  /** The clickable element that opens the picker (a chip in the reader, an icon in
   *  the list row). Rendered as the Radix trigger via `asChild`. */
  trigger: ReactNode;
  align?: RadixPopover.PopoverContentProps['align'];
}

/**
 * ADR-158 §P2 — controlled popover hosting {@link MailPeoplePicker}. Controlled
 * (not the shared uncontrolled `Popover`) so a successful link/unlink closes it,
 * and so the picker keeps its own dividers/padding instead of the shared `p-3`.
 */
export function MailLinkPopover({ spaceId, message, trigger, align = 'start' }: MailLinkPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side="bottom"
          sideOffset={4}
          className="z-[100] overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
        >
          <MailPeoplePicker spaceId={spaceId} message={message} onDone={() => setOpen(false)} />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
