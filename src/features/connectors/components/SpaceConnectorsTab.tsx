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
} from '@/features/connectors/api/connectorsApi';
import {
  BrandedProviderForm,
  CustomTypeForm,
} from '@/features/connectors/components/ConnectorAddForms';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60_000;

export interface SpaceConnectorsTabProps {
  spaceId: number;
}

export function SpaceConnectorsTab({ spaceId }: SpaceConnectorsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [pendingTypeSlug, setPendingTypeSlug] = useState<string | null>(null);

  const pollDeadlineRef = useRef<number>(0);

  const { data: catalogue = [], isLoading: catalogueLoading } = useQuery({
    queryKey: ['connectors', 'catalogue'],
    queryFn: () => connectorsApi.catalogue(),
    staleTime: 5 * 60_000,
  });

  const {
    data: connectors = [],
    isLoading: listLoading,
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
      toast.success('Connector linked');
      const next = new URLSearchParams(searchParams);
      next.delete('connected');
      setSearchParams(next, { replace: true });
      const t = window.setTimeout(() => setHighlightId(null), 4000);
      return () => window.clearTimeout(t);
    }
  }, [searchParams, setSearchParams, refetch]);

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
      toast.success('Connector linked');
      return;
    }
    if (Date.now() > pollDeadlineRef.current) {
      setPendingTypeSlug(null);
      pollDeadlineRef.current = 0;
      toast.error('OAuth flow timed out. Reload to check status.');
    }
  }, [pendingTypeSlug, connectors]);

  const brandedTypes = useMemo(
    () => catalogue.filter((t) => !t.slug.startsWith('custom_')),
    [catalogue]
  );
  const customTypes = useMemo(
    () => catalogue.filter((t) => t.slug.startsWith('custom_')),
    [catalogue]
  );

  if (!Number.isFinite(spaceId)) {
    return <div className="text-sm text-red-500">Invalid space id</div>;
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
    // Route by auth_kind, not slug prefix: BrandedProviderForm is OAuth-only
    // (it calls startOAuth). Any api_key type — custom_* or a first-class one
    // like `imap` (ADR-160) — uses the data-driven CustomTypeForm, which renders
    // `t.fields` and calls createApiKey. All branded types today are oauth2, so
    // this is behavior-preserving for them.
    const isBrandedOAuth = t.auth_kind === 'oauth2' && !isCustom;
    return (
      <div key={t.slug} className={isExpanded ? 'rounded-lg border border-[var(--border-primary)]' : ''}>
        <button
          type="button"
          onClick={() => toggle(t.slug)}
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
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-mono">
              {t.auth_kind}
            </span>
          )}
        </button>
        {isExpanded && (
          isBrandedOAuth ? (
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
      <p className="text-sm text-[var(--text-tertiary)]">
        OAuth и API-ключи, доступные MCP-инструментам, агентам и автоматизациям этого пространства.
      </p>

      {pendingTypeSlug && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-700 dark:text-blue-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Ожидание OAuth-ответа… завершите вход в открывшейся вкладке.
        </div>
      )}

      {/* Existing connectors */}
      {listLoading ? (
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
      {!catalogueLoading && (brandedTypes.length > 0 || customTypes.length > 0) && (
        <div className="pt-2 border-t border-[var(--border-primary)] space-y-2">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            Добавить коннектор
          </h4>
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
  const [busy, setBusy] = useState<'refresh' | 'revoke' | null>(null);

  const refreshSupported = catalogueType?.refresh_supported ?? false;
  const isApiKey = connector.kind === 'api_key';
  const isRevoked = connector.status === 'revoked';

  const handleRefresh = async () => {
    setBusy('refresh');
    try {
      await connectorsApi.refresh(spaceId, connector.id);
      toast.success('Refreshed');
      onChanged();
    } catch (err) {
      toast.error(extractErrorMessage(err) || 'Refresh failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async () => {
    if (!confirm(`Revoke "${connector.display_name}"? This zeroes the stored secret.`)) {
      return;
    }
    setBusy('revoke');
    try {
      await connectorsApi.revoke(spaceId, connector.id);
      toast.success('Revoked');
      onChanged();
    } catch (err) {
      toast.error(extractErrorMessage(err) || 'Revoke failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`bg-[var(--bg-secondary)] border rounded-lg p-4 transition-colors ${
        highlight
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : isRevoked
            ? 'border-[var(--border-primary)] opacity-60'
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
              <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-2 flex-wrap">
                <code className="font-mono">{connector.type_slug}</code>
                {connector.account_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{connector.account_label}</span>
                  </>
                )}
              </div>
            </div>
            <StatusPill status={connector.status} />
          </div>

          {connector.last_error && connector.status !== 'active' && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-red-500">
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

          <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-tertiary)] flex-wrap">
            {connector.last_refresh_at && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Refreshed {formatRelative(connector.last_refresh_at)}
              </span>
            )}
            {connector.expires_at && (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Expires {formatRelative(connector.expires_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!isApiKey && !isRevoked && (
            <button
              type="button"
              onClick={onEditScopes}
              title="Edit scopes (re-runs OAuth)"
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
              title="Refresh now"
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
              title="Revoke"
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
    </div>
  );
}

function StatusPill({ status }: { status: ConnectorStatus }) {
  const map: Record<ConnectorStatus, { label: string; cls: string }> = {
    pending: {
      label: 'pending',
      cls: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
    },
    active: { label: 'active', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    expired: { label: 'expired', cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
    revoked: { label: 'revoked', cls: 'bg-red-500/10 text-red-500' },
    error: { label: 'error', cls: 'bg-red-500/10 text-red-500' },
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
  return (
    <div className="text-center py-8 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
      <Plug className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3 opacity-50" />
      <p className="text-sm text-[var(--text-secondary)] mb-1">
        Пока нет подключённых коннекторов
      </p>
      <p className="text-xs text-[var(--text-tertiary)]">
        Раскройте провайдера ниже, чтобы добавить первый.
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = then - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const past = diffMs < 0;
  if (abs < min) return past ? 'just now' : 'in <1m';
  if (abs < hr) {
    const m = Math.round(abs / min);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < day) {
    const h = Math.round(abs / hr);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / day);
  return past ? `${d}d ago` : `in ${d}d`;
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
