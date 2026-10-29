/**
 * ADR-0028 Phase 3 — Space Connectors tab body.
 *
 * Reusable surface used by:
 *   - EditSpaceModal "Connectors" tab (primary entry point)
 *   - SpaceConnectorsPage (route /spaces/:spaceId/settings/connectors —
 *     kept as the OAuth callback landing target, ?connected=:id flashes
 *     the row and the URL param is dropped client-side)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button } from '@/shared/components/ui/Button';
import { Switch } from '@/shared/components/ui/Switch';
import { McpConnectorForm, McpScope } from './McpConnectorForm';
import { RemoteMcpForm, isRemoteMcp } from './RemoteMcpForm';
import { RemoteMcpTools } from './RemoteMcpTools';
import {
  RefreshCw,
  Trash2,
  Pencil,
  KeyRound,
  AlertTriangle,
  Loader2,
  Clock,
  CheckCircle2,
  Plug,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  connectorsApi,
  CatalogueType,
  ConnectorStatus,
  SpaceConnector,
  ConnectorCheck,
  ConnectorAuthKind,
} from '@/features/connectors/api/connectorsApi';
import {
  BrandedProviderForm,
  CustomTypeForm,
} from '@/features/connectors/components/ConnectorAddForms';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

export interface SpaceConnectorsTabProps {
  spaceId: number;
  /**
   * Catalogue slug to expand on mount (e.g. `'imap'` when opened from the mail
   * widget so the IMAP/SMTP form is ready without an extra click). The user can
   * still collapse it or open another provider — this only seeds initial state.
   */
  initialExpandedSlug?: string | null;
}

export function SpaceConnectorsTab({ spaceId, initialExpandedSlug = null }: SpaceConnectorsTabProps) {
  const { t: translate } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [expandedSlug, setExpandedSlug] = useState<string | null>(initialExpandedSlug);
  const [authFilter, setAuthFilter] = useState<ConnectorAuthKind | 'all'>('all');
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [pendingTypeSlug, setPendingTypeSlug] = useState<string | null>(null);

  const pollDeadlineRef = useRef<number>(0);

  const { data: catalogue = [], isLoading: catalogueLoading, isError: catalogueError, refetch: refetchCatalogue } = useQuery({
    queryKey: ['connectors', 'catalogue'],
    queryFn: () => connectorsApi.catalogue(),
    staleTime: 5 * 60_000,
  });

  const {
    data: connectors = [],
    isLoading: listLoading,
    isError: listError,
    refetch,
  } = useQuery({
    queryKey: ['connectors', 'list', spaceId],
    queryFn: () => connectorsApi.list(spaceId),
    enabled: Number.isFinite(spaceId),
    refetchInterval: pendingTypeSlug ? POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (!connected) return;
    const id = Number(connected);
    if (Number.isFinite(id)) {
      setHighlightId(id);
      setPendingTypeSlug(null);
      void refetch();
      toast.success(translate('spaces.connectors.linked'));
      const next = new URLSearchParams(searchParams);
      next.delete('connected');
      setSearchParams(next, { replace: true });
      const t = window.setTimeout(() => setHighlightId(null), 4000);
      return () => window.clearTimeout(t);
    }
  }, [searchParams, setSearchParams, refetch, translate]);

  useEffect(() => {
    if (!pendingTypeSlug) return;
    if (!pollDeadlineRef.current) {
      pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    }
    const matched = connectors.some(
      (c) =>
        c.type_slug === pendingTypeSlug &&
        c.status !== 'revoked' &&
        Date.now() - new Date(c.created_at).getTime() < POLL_TIMEOUT_MS
    );
    if (matched) {
      setPendingTypeSlug(null);
      pollDeadlineRef.current = 0;
      toast.success(translate('spaces.connectors.linked'));
      return;
    }
    if (Date.now() > pollDeadlineRef.current) {
      setPendingTypeSlug(null);
      pollDeadlineRef.current = 0;
      toast.error(translate('spaces.connectors.oauthTimeout'));
    }
  }, [pendingTypeSlug, connectors, translate]);

  const brandedTypes = useMemo(
    () => catalogue.filter((t) => !t.slug.startsWith('custom_') && (authFilter === 'all' || t.auth_kind === authFilter)),
    [catalogue, authFilter]
  );
  const customTypes = useMemo(
    () => catalogue.filter((t) => t.slug.startsWith('custom_') && (authFilter === 'all' || t.auth_kind === authFilter)),
    [catalogue, authFilter]
  );

  if (!Number.isFinite(spaceId)) {
    return <div className="text-sm text-red-500">{translate('spaces.connectors.invalidSpace')}</div>;
  }

  const toggle = (slug: string) =>
    setExpandedSlug((prev) => (prev === slug ? null : slug));

  const handleOAuthLaunched = (slug: string) => {
    setPendingTypeSlug(slug);
    pollDeadlineRef.current = 0;
  };

  const handleApiKeyCreated = () =>
    queryClient.invalidateQueries({ queryKey: ['connectors', 'list', spaceId] });

  const renderTypeChip = (t: CatalogueType) => {
    const isExpanded = expandedSlug === t.slug;
    const isCustom = t.slug.startsWith('custom_');
    // Remote MCP and the pinned local Blender connector have separate forms.
    const isBrandedOAuth = t.auth_kind === 'oauth2' && !isCustom;
    return (
      <div key={t.slug} className={isExpanded ? 'rounded-lg border border-[var(--border-primary)]' : ''}>
        <button
          type="button"
          onClick={() => toggle(t.slug)}
          aria-expanded={isExpanded}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
            isExpanded
              ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-t-lg'
              : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
          )}
          <span className="text-base leading-none">{t.icon}</span>
          <span className="flex-1 text-left">{t.display_name}</span>
          {!isBrandedOAuth && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-mono">
              {t.auth_kind}
            </span>
          )}
        </button>
        {isExpanded && (
          isRemoteMcp(t.slug) ? (
            <RemoteMcpForm spaceId={spaceId} selected={t}
              onCreated={() => { void handleApiKeyCreated(); setExpandedSlug(null); }} />
          ) : t.auth_kind === 'mcp' ? (
            listLoading ? <ListSkeleton /> : !listError && <McpConnectorForm
              spaceId={spaceId}
              selected={t}
              alreadyAdded={connectors.some(c => c.type_slug === t.slug && c.status !== 'revoked')}
              onCreated={() => { void handleApiKeyCreated(); setExpandedSlug(null); }}
            />
          ) : isBrandedOAuth ? (
            <BrandedProviderForm
              spaceId={spaceId}
              selected={t}
              onCollapse={() => setExpandedSlug(null)}
              onOAuthLaunched={handleOAuthLaunched}
            />
          ) : (
            <CustomTypeForm
              spaceId={spaceId}
              selected={t}
              onCollapse={() => setExpandedSlug(null)}
              onOAuthLaunched={handleOAuthLaunched}
              onApiKeyCreated={handleApiKeyCreated}
            />
          )
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        {translate('spaces.connectors.description')}
      </p>

      {pendingTypeSlug && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-700 dark:text-blue-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          {translate('spaces.connectors.waitingOAuth')}
        </div>
      )}

      {/* Existing connectors */}
      {(listError || catalogueError) && (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-400">
          <p>{translate('spaces.connectors.loadFailed')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => { void refetch(); void refetchCatalogue(); }}>
            {translate('spaces.connectors.retry')}
          </Button>
        </div>
      )}
      {listError ? null : listLoading ? (
        <ListSkeleton />
      ) : connectors.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <ConnectorRow
              key={c.id}
              connector={c}
              catalogueType={catalogue.find((t) => t.slug === c.type_slug) ?? null}
              spaceId={spaceId}
              highlight={c.id === highlightId}
              onChanged={() =>
                queryClient.invalidateQueries({ queryKey: ['connectors', 'list', spaceId] })
              }
              onEditScopes={() => setExpandedSlug(c.type_slug)}
            />
          ))}
        </div>
      )}

      {/* Add new connector — chip-with-chevron disclosure */}
      {!catalogueLoading && catalogue.length > 0 && (
        <div className="pt-2 border-t border-[var(--border-primary)] space-y-2">
          <h4 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            {translate('spaces.connectors.addConnector')}
          </h4>
          <div role="group" aria-label={translate('spaces.connectors.filterLabel')} className="flex flex-wrap gap-2">
            {(['all', 'mcp', 'api_key', 'oauth2'] as const).map(kind => (
              <Button key={kind} type="button" variant="secondary" size="sm" aria-pressed={authFilter === kind}
                className="aria-pressed:ring-2 aria-pressed:ring-[var(--color-primary-500)]"
                onClick={() => setAuthFilter(kind)}>
                {translate(`spaces.connectors.filters.${kind}`)}
              </Button>
            ))}
          </div>
          {brandedTypes.length === 0 && customTypes.length === 0 && <p role="status" className="text-sm text-[var(--text-secondary)]">
            {translate('spaces.connectors.noMatchingTypes')}
          </p>}
          <div className="space-y-1.5">
            {brandedTypes.map(renderTypeChip)}
            {customTypes.length > 0 && brandedTypes.length > 0 && (
              <div className="h-px bg-[var(--border-primary)] my-2" />
            )}
            {customTypes.map(renderTypeChip)}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  catalogueType,
  spaceId,
  highlight,
  onChanged,
  onEditScopes,
}: {
  connector: SpaceConnector;
  catalogueType: CatalogueType | null;
  spaceId: number;
  highlight: boolean;
  onChanged: () => void;
  onEditScopes: () => void;
}) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'refresh' | 'revoke' | 'toggle' | 'test' | 'discover' | 'save' | null>(null);
  const [check, setCheck] = useState<ConnectorCheck | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const refreshSupported = catalogueType?.refresh_supported ?? false;
  const isApiKey = connector.kind === 'api_key';
  const isRevoked = connector.status === 'revoked';
  const isMcp = connector.kind === 'mcp';
  const isMidjourney = connector.type_slug === 'midjourney';
  const remoteMcp = isMcp && isRemoteMcp(connector.type_slug);
  const enabled = connector.enabled ?? connector.status === 'active';

  const handleMcpAction = async (action: 'toggle' | 'test') => {
    if (busy || isRevoked) return;
    setBusy(action);
    setMcpError(null);
    setCheck(null);
    try {
      let updated: SpaceConnector;
      if (action === 'toggle') {
        updated = await connectorsApi.setEnabled(spaceId, connector.id, !enabled);
      } else {
        const result = await connectorsApi.test(spaceId, connector.id);
        updated = result.connector;
        setCheck(result.check);
      }
      queryClient.setQueryData<SpaceConnector[]>(['connectors', 'list', spaceId], rows =>
        rows?.map(row => row.id === updated.id ? updated : row)
      );
    } catch {
      setMcpError(t(`spaces.connectors.mcp.${action === 'toggle' ? 'updateFailed' : 'testFailed'}`));
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    setBusy('refresh');
    try {
      await connectorsApi.refresh(spaceId, connector.id);
      toast.success(t('spaces.connectors.refreshed'));
      onChanged();
    } catch (err) {
      toast.error(extractErrorMessage(err) || t('spaces.connectors.refreshFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async () => {
    if (!confirm(t('spaces.connectors.revokeConfirm', { name: connector.display_name }))) {
      return;
    }
    setBusy('revoke');
    try {
      await connectorsApi.revoke(spaceId, connector.id);
      toast.success(t('spaces.connectors.revoked'));
      onChanged();
    } catch (err) {
      toast.error(extractErrorMessage(err) || t('spaces.connectors.revokeFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`bg-[var(--bg-secondary)] border rounded-lg p-4 transition-colors ${
        highlight
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : 'border-[var(--border-primary)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="p-2 rounded-lg bg-primary-500/10">
              {isApiKey ? (
                <KeyRound className="w-5 h-5 text-primary-500" />
              ) : (
                <span className="text-xl leading-none">
                  {catalogueType?.icon ?? '🔌'}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h4 className="font-medium text-[var(--text-primary)] truncate">
                {connector.display_name}
              </h4>
              <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2 flex-wrap">
                <code className="font-mono">{connector.type_slug}</code>
                {connector.account_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{connector.account_label}</span>
                  </>
                )}
              </div>
            </div>
            {remoteMcp && connector.status === 'active' ? (
              <span className="text-xs text-[var(--text-secondary)]">{t(`spaces.connectors.remote.${
                !connector.last_checked_at ? 'unchecked' : connector.last_error ? 'failed' : 'checked'
              }`)}</span>
            ) : <StatusPill status={connector.status} />}
          </div>

          {connector.last_error && (isMcp || isMidjourney || connector.status !== 'active') && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="break-all">{connector.last_error}</span>
            </div>
          )}

          {(connector.scopes_granted.length > 0 || connector.scopes_requested.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {(connector.scopes_granted.length > 0
                ? connector.scopes_granted
                : connector.scopes_requested
              ).map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 text-xs rounded bg-primary-500/10 text-primary-500 font-mono"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-secondary)] flex-wrap">
            {connector.last_refresh_at && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {t('spaces.connectors.lastRefresh', { time: formatRelative(connector.last_refresh_at, language) })}
              </span>
            )}
            {connector.expires_at && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('spaces.connectors.expires', { time: formatRelative(connector.expires_at, language) })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!isApiKey && !isMcp && !isRevoked && (
            <button
              type="button"
              onClick={onEditScopes}
              title={t('spaces.connectors.editScopes')}
              aria-label={t('spaces.connectors.editScopes')}
              className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {refreshSupported && !isRevoked && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy !== null}
              title={t('spaces.connectors.refreshNow')}
              aria-label={t('spaces.connectors.refreshNow')}
              className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {busy === 'refresh' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          )}
          {!isRevoked && (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={busy !== null}
              title={t('spaces.connectors.revoke')}
              aria-label={t('spaces.connectors.revoke')}
              className="p-2 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50"
            >
              {busy === 'revoke' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
      {(isMcp || isMidjourney) && (
        <div className="mt-3 space-y-3">
          {isMidjourney ? <p className="text-xs text-[var(--text-secondary)]">{t('spaces.connectors.midjourney.hint')}</p>
            : remoteMcp ? <p className="text-xs text-[var(--text-secondary)]">{t('spaces.connectors.remote.agentHint')}</p> : <McpScope config={connector.mcp} />}
          {!isRevoked && <>
            <Switch label={t('spaces.connectors.mcp.enableName', { name: connector.display_name })}
              checked={enabled} onCheckedChange={() => void handleMcpAction('toggle')}
              aria-disabled={busy !== null} disabled={busy !== null && busy !== 'toggle'}
              className="shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)] disabled:opacity-50" />
            <p className="text-xs text-[var(--text-secondary)]">{t(`spaces.connectors.${remoteMcp || isMidjourney ? 'remote.toggleHint' : 'mcp.toggleHint'}`)}</p>
            <Button type="button" variant="secondary" size="sm" loading={busy === 'test'} disabled={busy !== null || !enabled}
              onClick={() => void handleMcpAction('test')}>{t('spaces.connectors.mcp.test')}</Button>
          </>}
          {connector.last_checked_at && <p className="text-xs text-[var(--text-secondary)]">
            {t('spaces.connectors.mcp.lastChecked', { time: new Date(connector.last_checked_at).toLocaleString(language) })}
          </p>}
          <div role="status" className="text-sm text-[var(--text-secondary)]">
            {check && <>
              <p>{t(isMidjourney && check.ok ? 'spaces.connectors.midjourney.checkOk' : `spaces.connectors.mcp.${check.ok ? 'checkOk' : 'checkFailed'}`)}
                {check.latency_ms !== undefined && <> · {t('spaces.connectors.mcp.latency', { ms: check.latency_ms })}</>}
              </p>
              {check.error_code && <p>{t(`spaces.connectors.mcp.errors.${check.error_code}`)}</p>}
              {check.tool_count !== undefined && <p>{t('spaces.connectors.mcp.tools', { count: check.tool_count })}</p>}
              {check.server_name && <p className="break-words">{check.server_name} {check.server_version}</p>}
            </>}
          </div>
          {remoteMcp && <RemoteMcpTools key={connector.id}
            connector={connector} spaceId={spaceId} disabled={busy !== null || !enabled || isRevoked}
            busy={busy} onBusyChange={setBusy} />}
          {mcpError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{mcpError}</p>}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ConnectorStatus }) {
  const { t } = useLanguage();
  const map: Record<ConnectorStatus, { label: string; cls: string }> = {
    pending: {
      label: t('spaces.connectors.status.pending'),
      cls: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
    },
    active: { label: t('spaces.connectors.status.active'), cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
    disabled: { label: t('spaces.connectors.status.disabled'), cls: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]' },
    expired: { label: t('spaces.connectors.status.expired'), cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
    revoked: { label: t('spaces.connectors.status.revoked'), cls: 'bg-red-500/10 text-red-700 dark:text-red-400' },
    error: { label: t('spaces.connectors.status.error'), cls: 'bg-red-500/10 text-red-500' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4 animate-pulse h-20"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  const { t: translate } = useLanguage();
  return (
    <div className="text-center py-8 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
      <Plug className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3 opacity-50" />
      <p className="text-sm text-[var(--text-secondary)] mb-1">
        {translate('spaces.connectors.empty')}
      </p>
      <p className="text-xs text-[var(--text-secondary)]">
        {translate('spaces.connectors.emptyHint')}
      </p>
    </div>
  );
}

function formatRelative(iso: string, language: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = then - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (abs < min) return relative.format(0, 'second');
  if (abs < hr) return relative.format(Math.round(diffMs / min), 'minute');
  if (abs < day) return relative.format(Math.round(diffMs / hr), 'hour');
  return relative.format(Math.round(diffMs / day), 'day');
}

function extractErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed?.error?.message ?? parsed?.message ?? err.message;
    } catch {
      return err.message;
    }
  }
  return null;
}

export default SpaceConnectorsTab;
