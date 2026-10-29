import { type ReactNode, useEffect, useRef } from 'react';
import { Search, PenSquare, RefreshCw, MailOpen, Menu, Settings } from 'lucide-react';
import { Button, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface MailToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onCompose: () => void;
  onSync: () => void;
  syncing: boolean;
  canSync: boolean;
  /** Left folder rail collapse state — the hamburger toggles it. */
  railOpen: boolean;
  onToggleRail: () => void;
  /** Unread-only view filter (Favorites lives in the folder rail). */
  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  /** Open the mail Settings dialog (Gmail-style gear). */
  onOpenSettings: () => void;
  /** Select-all checkbox (leftmost list control). `allChecked` = every visible
   *  row is selected; `someChecked` (but not all) renders the indeterminate dash.
   *  Disabled when the list is empty. */
  allChecked: boolean;
  someChecked: boolean;
  onToggleSelectAll: () => void;
  selectAllDisabled?: boolean;
  /** Bulk actions for the checkbox selection — rendered next to Compose, only
   *  when a selection exists (the parent passes null otherwise). */
  bulkSlot?: ReactNode;
  /** Account switcher — rendered on the far right of the bar. */
  accountSwitcher?: ReactNode;
}

const Divider = () => (
  <div className="mx-1 hidden h-6 w-px bg-[var(--border-primary)] md:block" aria-hidden="true" />
);

/**
 * Header select-all checkbox. Native input (matches the row checkboxes) with the
 * indeterminate flag driven imperatively — React has no `indeterminate` prop.
 */
function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onToggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      aria-label={t('mail.toolbar.selectAll')}
      title={t('mail.toolbar.selectAllShort')}
      className="ml-1 h-4 w-4 flex-shrink-0 cursor-pointer accent-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/**
 * ADR-158 — the mail module's top (list-scoped) toolbar. Order (L→R): hamburger
 * (folder rail) · unread filter · search (flex, shrinks) · sync · bulk actions
 * (when a selection exists) · Compose · divider · Settings gear · account switcher
 * pinned to the far edge. Message-scoped controls live in MailReadToolbar.
 */
export function MailToolbar({
  query,
  onQueryChange,
  onCompose,
  onSync,
  syncing,
  canSync,
  railOpen,
  onToggleRail,
  unreadOnly,
  onUnreadOnlyChange,
  onOpenSettings,
  allChecked,
  someChecked,
  onToggleSelectAll,
  selectAllDisabled,
  bulkSlot,
  accountSwitcher,
}: MailToolbarProps) {
  const { t } = useLanguage();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-2 max-md:[&>button]:h-11 max-md:[&>button]:min-w-11 md:flex-nowrap md:gap-2 md:overflow-x-auto md:px-3">
      {/* Left — hamburger collapses/expands the vertical folder rail. */}
      <button
        type="button"
        aria-label={railOpen ? t('mail.toolbar.collapseFolders') : t('mail.toolbar.expandFolders')}
        aria-expanded={railOpen}
        title={t('mail.toolbar.folders')}
        onClick={onToggleRail}
        className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Menu size={18} />
      </button>

      <Divider />

      {/* Select-all — leftmost list control, directly left of the unread filter.
          Toggles the checkbox selection over every currently-visible row. */}
      <SelectAllCheckbox
        checked={allChecked}
        indeterminate={someChecked && !allChecked}
        disabled={selectAllDisabled}
        onToggle={onToggleSelectAll}
      />

      {/* Unread-only filter — directly left of search. */}
      <button
        type="button"
        aria-pressed={unreadOnly}
        title={t('mail.toolbar.unreadOnly')}
        aria-label={t('mail.toolbar.unreadOnly')}
        onClick={() => onUnreadOnlyChange(!unreadOnly)}
        className={cn(
          'flex-shrink-0 rounded-md p-1.5 transition-colors',
          unreadOnly
            ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
        )}
      >
        <MailOpen size={16} />
      </button>

      {/* On phones search and account selection each get a full row. */}
      <div className="order-1 min-w-0 basis-full md:order-none md:min-w-[7rem] md:flex-1 md:basis-auto">
        <Input
          placeholder={t('mail.toolbar.search')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          leftAddon={<Search size={16} />}
          aria-label={t('mail.toolbar.search')}
        />
      </div>

      {/* Sync — right of search. */}
      <Button
        variant="ghost"
        size="sm"
        className="flex-shrink-0"
        aria-label={t('mail.toolbar.sync')}
        title={t('mail.toolbar.sync')}
        disabled={!canSync || syncing}
        onClick={onSync}
      >
        <RefreshCw size={16} className={syncing ? 'animate-spin' : undefined} />
      </Button>

      {/* Bulk actions for the checkbox selection — appear right of Sync the moment
          one or more rows are checked. */}
      {bulkSlot && (
        <div className="order-3 flex w-full items-center overflow-x-auto md:order-none md:w-auto md:shrink-0">
          <Divider />
          {bulkSlot}
        </div>
      )}

      {/* Compose — icon-only on mobile so it doesn't push the account switcher onto
          a new line; label returns at ≥sm. */}
      <Button size="sm" className="flex-shrink-0" aria-label={t('mail.toolbar.composeLabel')} onClick={onCompose}>
        <PenSquare size={14} />
        <span className="ml-1.5 hidden sm:inline">{t('mail.toolbar.compose')}</span>
      </Button>

      <Divider />

      {/* Settings — opens the in-place mail settings surface (gear); left of the
          account switcher. */}
      <button
        type="button"
        title={t('mail.toolbar.settings')}
        aria-label={t('mail.toolbar.settings')}
        onClick={onOpenSettings}
        className="flex-shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Settings size={16} />
      </button>

      {/* Right — account switcher pinned to the far edge. */}
      {accountSwitcher && <div className="order-2 min-w-0 basis-full md:order-none md:w-48 md:shrink-0 md:basis-auto">{accountSwitcher}</div>}
    </div>
  );
}
