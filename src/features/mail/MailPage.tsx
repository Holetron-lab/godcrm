import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, PenSquare, RefreshCw } from 'lucide-react';
import { Button, Input } from '@/shared/components/ui';
import { AccountSwitcher, useConnectedAccounts } from '@/features/connectors';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { MailNav } from './components/MailNav';
import { MailList } from './components/MailList';
import { MailDisplay } from './components/MailDisplay';
import { useMailFolders, useMailMessages, useMailMessage, useSyncMail } from './hooks/useMail';
import type { MailFolder, MailFolderId } from './types';

// Nav skeleton for first paint — the server returns the same list with live unread
// counts once useMailFolders resolves; this just avoids an empty rail on load.
const FALLBACK_FOLDERS: MailFolder[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'sent', label: 'Sent' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archive', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

/**
 * P1 mail shell (ADR-158) wired to the live mail bridge (ADR-160). Three-pane
 * inbox on our own `ui/` kit + design tokens. Selection state is local `useState`;
 * data comes from TanStack Query over `/api/v3/spaces/:id/mail/*`, scoped to the
 * active connected mailbox (account switcher → `connector_id`).
 */
export function MailPage() {
  const navigate = useNavigate();
  const currentSpace = useCurrentSpace();
  const spaceId = currentSpace?.id;

  const [folder, setFolder] = useState<MailFolderId>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // ADR-159 — active connected account (view concern; server-side default
  // per module instance is a backend follow-up).
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const { data: accounts } = useConnectedAccounts(spaceId, 'mail');

  // Default to the first connected mailbox once accounts load.
  useEffect(() => {
    if (activeAccountId === null && accounts && accounts.length > 0) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId]);

  const goConnect = () =>
    spaceId && navigate(`/spaces/${spaceId}/settings/connectors`);

  const foldersQuery = useMailFolders(spaceId, activeAccountId);
  const folders = foldersQuery.data ?? FALLBACK_FOLDERS;

  const messagesQuery = useMailMessages(spaceId, folder, activeAccountId);
  const allMessages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  const sync = useSyncMail(spaceId, activeAccountId);

  // Client-side search over the loaded page (server-side search is a follow-up).
  const messages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMessages;
    return allMessages.filter((m) =>
      `${m.subject} ${m.fromName} ${m.preview}`.toLowerCase().includes(q)
    );
  }, [allMessages, query]);

  // Opening a message fetches the fresh row (and marks it read server-side); fall
  // back to the list row while the detail request is in flight.
  const detailQuery = useMailMessage(spaceId, selectedId);
  const selected = useMemo(
    () => detailQuery.data ?? allMessages.find((m) => m.id === selectedId) ?? null,
    [detailQuery.data, allMessages, selectedId]
  );

  const switchFolder = (id: MailFolderId) => {
    setFolder(id);
    setSelectedId(null);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 divide-x divide-[var(--border-primary)] bg-[var(--bg-primary)] md:grid-cols-[220px_minmax(280px,360px)_1fr]">
      {/* Pane 1 — folders */}
      <aside className="hidden flex-col md:flex">
        <div className="border-b border-[var(--border-primary)] p-2">
          <AccountSwitcher
            spaceId={spaceId}
            compatibleWith="mail"
            activeId={activeAccountId}
            onSwitch={setActiveAccountId}
            onConnect={goConnect}
          />
        </div>
        <div className="flex items-center justify-between p-3">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Mail</span>
          {/* ponytail: compose drawer (react-email body assembly) lands in P3 — shell only here */}
          <Button size="sm" leftIcon={<PenSquare size={14} />}>
            Compose
          </Button>
        </div>
        <MailNav folders={folders} selected={folder} onSelect={switchFolder} />
      </aside>

      {/* Pane 2 — message list */}
      <section className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--border-primary)] p-3">
          <div className="flex-1">
            <Input
              placeholder="Search mail"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftAddon={<Search size={16} />}
              aria-label="Search mail"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Sync mail"
            disabled={!activeAccountId || sync.isPending}
            onClick={() => sync.mutate(folder)}
          >
            <RefreshCw size={16} className={sync.isPending ? 'animate-spin' : undefined} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {messagesQuery.isLoading ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
              Loading messages…
            </div>
          ) : messagesQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]">
              <span>Couldn’t load messages</span>
              <Button variant="secondary" size="sm" onClick={() => messagesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <MailList messages={messages} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
      </section>

      {/* Pane 3 — message display */}
      <section className="hidden min-h-0 md:block">
        <MailDisplay message={selected} />
      </section>
    </div>
  );
}
