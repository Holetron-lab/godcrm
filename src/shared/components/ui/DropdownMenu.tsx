import { ReactNode } from 'react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { cn } from '@/shared/utils/cn';

export interface DropdownMenuItem {
  label: string;
  value: string;
  onSelect?: () => void;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  submenu?: Array<{
    label: string;
    value: string;
    onSelect?: () => void;
  }>;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  align?: Dropdown.DropdownMenuContentProps['align'];
  side?: Dropdown.DropdownMenuContentProps['side'];
}

export const DropdownMenu = ({ trigger, items, align = 'end', side = 'bottom' }: DropdownMenuProps) => {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          side={side}
          sideOffset={5}
          className="z-[9999] min-w-[180px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-lg"
        >
          {items.map((item) => {
            if (item.submenu) {
              return (
                <Dropdown.Sub key={item.value}>
                  <Dropdown.SubTrigger className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:bg-[var(--bg-secondary)]">
                    <span className="flex items-center gap-2">
                      {item.icon && <span className="text-[var(--text-tertiary)]">{item.icon}</span>}
                      {item.label}
                    </span>
                    <span className="text-[var(--text-tertiary)]">›</span>
                  </Dropdown.SubTrigger>
                  <Dropdown.Portal>
                    <Dropdown.SubContent
                      className="z-[9999] min-w-[120px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-lg"
                      sideOffset={8}
                    >
                      {item.submenu.map((subItem) => (
                        <Dropdown.Item
                          key={subItem.value}
                          className="flex cursor-pointer select-none items-center rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:bg-[var(--bg-secondary)]"
                          onSelect={subItem.onSelect}
                        >
                          {subItem.label}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.SubContent>
                  </Dropdown.Portal>
                </Dropdown.Sub>
              );
            }
            
            return (
              <Dropdown.Item
                key={item.value}
                className={cn(
                  'flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:bg-[var(--bg-secondary)]',
                  item.danger && 'text-[var(--color-error)]'
                )}
                onSelect={item.onSelect}
              >
                <span className="flex items-center gap-2">
                  {item.icon && <span className="text-[var(--text-tertiary)]">{item.icon}</span>}
                  {item.label}
                </span>
                {item.shortcut && <span className="text-xs text-[var(--text-tertiary)]">{item.shortcut}</span>}
              </Dropdown.Item>
            );
          })}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
};
