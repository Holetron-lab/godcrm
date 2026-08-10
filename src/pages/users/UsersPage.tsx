import { useEffect, useMemo, useState, useRef } from 'react';
import { UniversalTable } from '@/features/tables/components/UniversalTable/UniversalTable';
import { useTablesBootstrap } from '@/features/tables/hooks/useTablesBootstrap';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useWorkspaceUsers } from '@/features/users/hooks/useWorkspaceUsers';
import { Button } from '@/shared/components/ui';

const UsersPage = () => {
  const { loading, error } = useTablesBootstrap();
  const tables = useTablesStore((state) => state.tables);
  const selectTable = useTablesStore((state) => state.selectTable);
  const setContextUserId = useTablesStore((state) => state.setContextUserId);
  const personalSummary = useTablesStore((state) => state.personalSummary);
  const { t } = useLanguage();
  const authUser = useAuthStore((state) => state.user);
  const isOwner = authUser?.role === 'owner';
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { data: workspaceUsers = [], isLoading: usersLoading } = useWorkspaceUsers(isOwner);
  const viewerNumericId = authUser?.id ? Number(authUser.id) : null;

  useEffect(() => {
    if (!isOwner) {
      setContextUserId(null);
    }
    return () => {
      setContextUserId(null);
    };
  }, [isOwner, setContextUserId]);

  useEffect(() => {
    if (!isOwner) return;
    const targetContextId =
      selectedUserId !== null && selectedUserId !== viewerNumericId ? selectedUserId : null;
    setContextUserId(targetContextId);
  }, [isOwner, selectedUserId, viewerNumericId, setContextUserId]);

  // ✅ Select users table when it appears - but prevent infinite loop
  const usersTableIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    const usersTable = tables.find((table) => table.name === 'users');
    if (usersTable && usersTableIdRef.current !== usersTable.id) {
      usersTableIdRef.current = usersTable.id;
      selectTable(usersTable.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]); // Don't add selectTable - causes infinite loop!

  const selectedUser = useMemo(() => {
    if (selectedUserId === null || selectedUserId === viewerNumericId) return null;
    return workspaceUsers.find((user) => user.id === selectedUserId) ?? null;
  }, [selectedUserId, workspaceUsers, viewerNumericId]);
  const readOnlyMessage = selectedUser ? t('users.readOnlyBanner').replace('{user}', selectedUser.name) : '';
  const viewingPersonalSummary =
    Boolean(personalSummary && selectedUser && personalSummary.userId === selectedUser.id);
  const personalSummaryText = personalSummary
    ? t('users.personalSummaryDescription')
        .replace('{tables}', String(personalSummary.tableCount))
        .replace('{rows}', String(personalSummary.rowCount))
    : '';

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--text-secondary)]">{t('users.subtitle')}</p>
        <h2 className="text-3xl font-semibold text-[var(--text-primary)]">{t('users.title')}</h2>
        {error && <p className="text-sm text-[var(--color-error)]">{String(error)}</p>}
      </div>
      {isOwner ? (
        <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
          <aside className="space-y-3 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">{t('users.listTitle')}</p>
            <div className="space-y-2">
              <Button
                type="button"
                variant={selectedUserId === null ? 'primary' : 'secondary'}
                className="w-full justify-start"
                onClick={() => setSelectedUserId(null)}
              >
                {t('users.myWorkspace')}
              </Button>
              {usersLoading ? (
                <p className="text-xs text-[var(--text-secondary)]">{t('common.loading')}</p>
              ) : (
                workspaceUsers
                  .filter((user) => user.id !== viewerNumericId)
                  .map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => setSelectedUserId(user.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      selectedUserId === user.id
                        ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/20'
                        : 'border-[var(--border-primary)] hover:border-[var(--color-primary-400)]'
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{user.name}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
                    <p className="text-xs text-[var(--text-tertiary)] uppercase">{user.role}</p>
                  </button>
                ))
              )}
            </div>
          </aside>
          <div className="space-y-4">
            {selectedUser && (
              <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-secondary)]">
                {readOnlyMessage}
              </div>
            )}
            {viewingPersonalSummary && personalSummary && (
              <div className="rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                <p className="font-semibold text-[var(--text-primary)]">{t('users.personalSummaryTitle')}</p>
                <p className="text-xs text-[var(--text-secondary)]">{personalSummaryText}</p>
              </div>
            )}
            {loading ? (
              <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-secondary)]">
                {t('common.loading')}
              </div>
            ) : (
              <UniversalTable />
            )}
          </div>
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-secondary)]">
          {t('common.loading')}
        </div>
      ) : (
        <UniversalTable />
      )}
    </section>
  );
};

export default UsersPage;
