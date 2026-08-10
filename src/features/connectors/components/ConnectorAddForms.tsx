/**
 * ADR-0028 Phase 3 — Inline forms for adding a connector.
 *
 * Used by SpaceConnectorsTab as the body of expandable chip rows
 * (chevron-disclosure pattern). Replaces the AddConnectorModal popup.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  connectorsApi,
  CatalogueType,
  CatalogueField,
  SpaceConnector,
} from '../api/connectorsApi';

function redirectUriHint(): string {
  if (typeof window === 'undefined') return '/api/v3/connectors/oauth/callback';
  return `${window.location.origin}/api/v3/connectors/oauth/callback`;
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

// ─── Branded provider form (no chooser, single provider) ─────────────

export function BrandedProviderForm({
  spaceId,
  selected,
  onCollapse,
  onOAuthLaunched,
}: {
  spaceId: number;
  selected: CatalogueType;
  onCollapse: () => void;
  onOAuthLaunched: (typeSlug: string) => void;
}) {
  const [displayName, setDisplayName] = useState(selected.display_name);
  const [scopes, setScopes] = useState<string[]>(selected.scopes_default);
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overrideClientId, setOverrideClientId] = useState('');
  const [overrideClientSecret, setOverrideClientSecret] = useState('');

  useEffect(() => {
    setDisplayName(selected.display_name);
    setScopes(selected.scopes_default);
    setAdvancedOpen(false);
    setOverrideClientId('');
    setOverrideClientSecret('');
  }, [selected.slug, selected.display_name, selected.scopes_default]);

  const allScopeValues = useMemo(() => {
    const fromChoices = selected.scopes_choices.map((c) => c.value);
    const fromDefault = selected.scopes_default;
    return Array.from(new Set([...fromDefault, ...fromChoices]));
  }, [selected]);

  const toggleScope = (value: string) => {
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  };

  const handleConnect = async () => {
    if (!displayName.trim()) {
      toast.error('Display name is required');
      return;
    }
    const clientIdTrim = overrideClientId.trim();
    const clientSecretTrim = overrideClientSecret.trim();
    if ((clientIdTrim || clientSecretTrim) && !(clientIdTrim && clientSecretTrim)) {
      toast.error('Provide BOTH client_id and client_secret in Advanced, or leave both blank.');
      return;
    }
    setBusy(true);
    try {
      const body: Parameters<typeof connectorsApi.startOAuth>[1] = {
        type_slug: selected.slug,
        display_name: displayName.trim(),
        scopes,
      };
      if (clientIdTrim && clientSecretTrim) {
        body.client_overrides = {
          client_id: clientIdTrim,
          client_secret: clientSecretTrim,
        };
      }
      const { authorize_url } = await connectorsApi.startOAuth(spaceId, body);
      const win = window.open(authorize_url, '_blank', 'noopener,noreferrer');
      if (!win) {
        toast.error('Pop-up blocked. Allow pop-ups for this site and try again.');
        setBusy(false);
        return;
      }
      onOAuthLaunched(selected.slug);
      onCollapse();
    } catch (err) {
      toast.error(extractErrorMessage(err) || 'Failed to start OAuth flow');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-3 bg-[var(--bg-tertiary)]/50 rounded-b-lg border-x border-b border-[var(--border-primary)]">
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] text-sm"
          placeholder={selected.display_name}
        />
      </div>

      {allScopeValues.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Scopes
          </label>
          <div className="space-y-0.5 p-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md max-h-40 overflow-y-auto">
            {allScopeValues.map((value) => {
              const choice = selected.scopes_choices.find((c) => c.value === value);
              return (
                <label
                  key={value}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(value)}
                    onChange={() => toggleScope(value)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-[var(--text-primary)] flex-1">
                    {choice?.label ?? value}
                  </span>
                  <code className="text-xs text-[var(--text-tertiary)] font-mono">
                    {value}
                  </code>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="border border-[var(--border-primary)] rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
        >
          {advancedOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <KeyRound className="w-3.5 h-3.5" />
          <span className="flex-1">Advanced — use your own OAuth app credentials</span>
        </button>
        {advancedOpen && (
          <div className="p-3 space-y-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/40">
            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              Leave blank to use the server's pre-configured client.
              Provide BOTH fields together to override — credentials are encrypted at rest.
            </p>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                Client ID
              </label>
              <input
                type="text"
                value={overrideClientId}
                onChange={(e) => setOverrideClientId(e.target.value)}
                autoComplete="off"
                placeholder={selected.client_env?.id ?? 'client_id'}
                className="w-full px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                Client Secret
              </label>
              <input
                type="password"
                value={overrideClientSecret}
                onChange={(e) => setOverrideClientSecret(e.target.value)}
                autoComplete="new-password"
                placeholder={selected.client_env?.secret ?? 'client_secret'}
                className="w-full px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] text-sm font-mono"
              />
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              Register redirect URI <code className="font-mono">{redirectUriHint()}</code>{' '}
              in your OAuth app dashboard.
            </p>
          </div>
        )}
      </div>

      <FormActions onCollapse={onCollapse} onSubmit={handleConnect} busy={busy} oauth />
    </div>
  );
}

// ─── Custom type form (no chooser, single subtype) ───────────────────

export function CustomTypeForm({
  spaceId,
  selected,
  onCollapse,
  onOAuthLaunched,
  onApiKeyCreated,
}: {
  spaceId: number;
  selected: CatalogueType;
  onCollapse: () => void;
  onOAuthLaunched: (typeSlug: string) => void;
  onApiKeyCreated: (connector: SpaceConnector) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName('');
    setValues({});
  }, [selected.slug]);

  const isOAuth = selected.auth_kind === 'oauth2';

  const handleConnect = async () => {
    if (!displayName.trim()) {
      toast.error('Display name is required');
      return;
    }
    for (const f of selected.fields) {
      if (f.required && !values[f.key]?.trim()) {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    setBusy(true);
    try {
      if (isOAuth) {
        const scopesStr = values.scopes?.trim() ?? '';
        const scopes = scopesStr
          ? scopesStr.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
        const { authorize_url } = await connectorsApi.startOAuth(spaceId, {
          type_slug: selected.slug,
          display_name: displayName.trim(),
          scopes,
          custom_definition: {
            client_id: values.client_id ?? '',
            authorize_url: values.authorize_url ?? '',
            token_url: values.token_url ?? '',
            ...(scopesStr ? { scopes: scopesStr } : {}),
          },
          fields: { client_secret: values.client_secret ?? '' },
        });
        const win = window.open(authorize_url, '_blank', 'noopener,noreferrer');
        if (!win) {
          toast.error('Pop-up blocked. Allow pop-ups for this site and try again.');
          setBusy(false);
          return;
        }
        onOAuthLaunched(selected.slug);
        onCollapse();
      } else {
        const fields: Record<string, string> = {};
        for (const f of selected.fields) {
          const v = values[f.key];
          if (v && v.trim()) fields[f.key] = v.trim();
        }
        const connector = await connectorsApi.createApiKey(spaceId, {
          type_slug: selected.slug,
          display_name: displayName.trim(),
          fields,
        });
        toast.success('Connector saved');
        onApiKeyCreated(connector);
        onCollapse();
      }
    } catch (err) {
      toast.error(extractErrorMessage(err) || 'Failed to create connector');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-3 bg-[var(--bg-tertiary)]/50 rounded-b-lg border-x border-b border-[var(--border-primary)]">
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Linear · prod"
          className="w-full px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] text-sm"
        />
      </div>

      {selected.fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key] ?? ''}
          onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
        />
      ))}

      <FormActions onCollapse={onCollapse} onSubmit={handleConnect} busy={busy} oauth={isOAuth} />
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CatalogueField;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputType =
    field.type === 'password'
      ? 'password'
      : field.type === 'url'
        ? 'url'
        : 'text';
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={field.type === 'password' ? 'new-password' : 'off'}
        className="w-full px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] text-sm font-mono"
      />
    </div>
  );
}

function FormActions({
  onCollapse,
  onSubmit,
  busy,
  oauth,
}: {
  onCollapse: () => void;
  onSubmit: () => void;
  busy: boolean;
  oauth: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCollapse}
        className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : oauth ? (
          <ExternalLink className="w-3.5 h-3.5" />
        ) : null}
        {busy ? 'Working…' : oauth ? 'Connect' : 'Save'}
      </button>
    </div>
  );
}
