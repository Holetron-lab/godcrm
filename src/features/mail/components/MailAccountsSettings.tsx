import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { connectorsApi, useConnectedAccounts } from '@/features/connectors';
import { accountName } from '@/features/connectors/components/AccountSwitcher';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface MailAccountsSettingsProps {
  spaceId: number | undefined;
  /** The mailbox the module is currently reading — marked in the list. */
  activeAccountId: number | null;
  /** Open the connect surface (same modal as the toolbar switcher). */
  onConnect: () => void;
}

/**
 * Settings → «Аккаунты и импорт»: the mailboxes connected to this space, read
 * straight off the connector rows (identity name / e-mail / status), with the
 * CRM display name editable inline. Connecting a new mailbox reuses the
 * existing connect modal.
 */
export function MailAccountsSettings({ spaceId, activeAccountId, onConnect }: MailAccountsSettingsProps) {
  const { t } = useLanguage();
  const { data: accounts = [], isLoading, isError } = useConnectedAccounts(spaceId, 'mail');
  const qc = useQueryClient();
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => connectorsApi.rename(spaceId!, id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);

  const save = async () => {
    if (!editing) return;
    const name = editing.value.trim();
    if (!name) return;
    try {
      await rename.mutateAsync({ id: editing.id, name });
      setEditing(null);
    } catch {
      /* error shown under the row */
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('mail.accounts.title')}</h3>
          <p className="text-xs text-[var(--text-tertiary)]">
            {t('mail.accounts.description')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onConnect}>
          <Plus size={14} />
          {t('mail.accounts.connect')}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-[var(--text-tertiary)]">{t('mail.common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-[var(--color-danger,#ef4444)]">
          {t('mail.accounts.loadFailed')}
        </p>
      )}
      {!isLoading && !isError && accounts.length === 0 && (
        <p className="text-sm text-[var(--text-tertiary)]">{t('mail.accounts.empty')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {accounts.map((a) => {
          const isEditing = editing?.id === a.id;
          const active = a.id === activeAccountId;
          return (
            <li
              key={a.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3',
                active ? 'border-[var(--color-primary-600)]' : 'border-[var(--border-primary)]'
              )}
            >
              <Avatar url={a.avatar_url} name={accountName(a)} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{accountName(a)}</span>
                  <span className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                    {t(`mail.accounts.status.${a.status}`)}
                  </span>
                  {active && (
                    <span className="rounded bg-[var(--color-primary-600)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {t('mail.accounts.active')}
                    </span>
                  )}
                </div>
                {a.email && <p className="truncate text-xs text-[var(--text-tertiary)]">{a.email}</p>}

                {/* CRM display name — the one line that is ours to edit. */}
                {isEditing ? (
                  <form
                    className="mt-2 flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                  >
                    <input
                      aria-label={t('mail.accounts.crmName')}
                      value={editing.value}
                      maxLength={120}
                      onChange={(e) => setEditing({ id: a.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary-500)]"
                    />
                    <button
                      type="submit"
                      aria-label={t('mail.accounts.saveName')}
                      title={t('mail.common.save')}
                      disabled={rename.isPending}
                      className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('mail.common.cancel')}
                      title={t('mail.common.cancel')}
                      onClick={() => setEditing(null)}
                      className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <p className="mt-1 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">{t('mail.accounts.crmNameLabel')}</span>
                    <span className="truncate">{a.display_name}</span>
                    <button
                      type="button"
                      aria-label={t('mail.accounts.rename', { name: a.display_name })}
                      title={t('mail.common.rename')}
                      onClick={() => setEditing({ id: a.id, value: a.display_name })}
                      className="rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <Pencil size={12} />
                    </button>
                  </p>
                )}
                {isEditing && rename.error && (
                  <p role="alert" className="mt-1 text-xs text-[var(--color-danger,#ef4444)]">
                    {rename.error.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
