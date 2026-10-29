import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronsUpDown, Plus, AlertCircle } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { cn } from '@/shared/utils/cn';
import { useConnectedAccounts } from '../hooks/useConnectedAccounts';
import type { ConnectorStatus, SpaceConnector } from '../api/connectorsApi';

/**
 * ADR-159 — in-place account switcher for account-backed modules.
 *
 * Reusable across modules (mail today; calendar/social next) — pass the
 * `compatibleWith` module slug. Binds directly to the Google-shaped identity
 * columns (`avatar_url` / `account_name` / `email`) with no per-provider
 * mapping. Switching is a view concern owned by the parent; server-side
 * "default account per module instance" is a backend follow-up (ADR-159).
 */
export interface AccountSwitcherProps {
  spaceId: number | undefined;
  /** module slug, e.g. 'mail'. */
  compatibleWith: string;
  /** currently-selected connector id (parent-owned). */
  activeId: number | null;
  onSwitch: (id: number) => void;
  /** open the connect surface (existing connector forms). */
  onConnect: () => void;
}

const STATUS_DOT: Record<ConnectorStatus, string> = {
  active: 'bg-emerald-500',
  disabled: 'bg-[var(--text-tertiary)]',
  pending: 'bg-amber-500',
  expired: 'bg-amber-500',
  error: 'bg-red-500',
  revoked: 'bg-red-500',
};

/** Identity-first label (ADR-159): account owner name → label → email → CRM display name. */
export function accountName(a: SpaceConnector): string {
  return a.account_name || a.account_label || a.email || a.display_name;
}

export function AccountSwitcher({
  spaceId,
  compatibleWith,
  activeId,
  onSwitch,
  onConnect,
}: AccountSwitcherProps) {
  const { data: accounts = [], isLoading, isError } = useConnectedAccounts(spaceId, compatibleWith);

  if (isLoading) {
    return (
      <div
        className="h-9 w-full animate-pulse rounded-md bg-[var(--bg-secondary)]"
        aria-busy="true"
        aria-label="Loading accounts"
      />
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--color-error)]">
        <AlertCircle size={14} aria-hidden="true" />
        <span>Couldn’t load accounts</span>
      </div>
    );
  }

  // No connected account yet — the switcher becomes the connect CTA.
  if (accounts.length === 0) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--border-primary)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Plus size={16} aria-hidden="true" />
        <span>Connect a mailbox</span>
      </button>
    );
  }

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
          aria-label={`Active account: ${accountName(active)}. Switch account`}
        >
          <Avatar url={active.avatar_url} name={accountName(active)} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
              {accountName(active)}
            </span>
            {active.email && (
              <span className="block truncate text-xs text-[var(--text-tertiary)]">
                {active.email}
              </span>
            )}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        </button>
      </Dropdown.Trigger>

      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={5}
          className="z-[9999] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[320px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-lg"
        >
          {accounts.map((a) => {
            const selected = a.id === active.id;
            return (
              <Dropdown.Item
                key={a.id}
                onSelect={() => onSwitch(a.id)}
                className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none focus:bg-[var(--bg-secondary)]"
              >
                <span className="relative shrink-0">
                  <Avatar url={a.avatar_url} name={accountName(a)} size={28} />
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)]',
                      STATUS_DOT[a.status]
                    )}
                    title={a.status}
                    aria-hidden="true"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--text-primary)]">{accountName(a)}</span>
                  {a.email && (
                    <span className="block truncate text-xs text-[var(--text-tertiary)]">{a.email}</span>
                  )}
                </span>
                {selected && <Check size={16} className="shrink-0 text-[var(--color-primary-600)]" aria-label="Active" />}
              </Dropdown.Item>
            );
          })}

          <Dropdown.Separator className="my-1 h-px bg-[var(--border-primary)]" />

          <Dropdown.Item
            onSelect={onConnect}
            className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--text-secondary)] outline-none focus:bg-[var(--bg-secondary)]"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Connect account</span>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
