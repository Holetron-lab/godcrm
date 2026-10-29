import { useId, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { connectorsApi, type CatalogueType, type McpConfig } from '../api/connectorsApi';

export function McpScope({ config }: { config?: McpConfig }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1 text-xs text-[var(--text-secondary)]">
      {config?.configured ? (
        <p>{t('spaces.connectors.mcp.scope', { agent: config.allowed_agent_id, space: config.allowed_space_id })}</p>
      ) : <p>{t('spaces.connectors.mcp.unconfigured')}</p>}
      {config?.safe_mode && <p>{t('spaces.connectors.mcp.safeMode')}</p>}
    </div>
  );
}

export function McpConnectorForm({ spaceId, selected, alreadyAdded, onCreated }: {
  spaceId: number;
  selected: CatalogueType;
  alreadyAdded: boolean;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [name, setName] = useState(selected.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unavailable = !selected.mcp?.configured;
  const wrongSpace = selected.mcp?.allowed_space_id !== spaceId;
  const blocked = unavailable || wrongSpace || alreadyAdded;

  return (
    <form className="p-4 space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (blocked || busy || !name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        await connectorsApi.createMcp(spaceId, { type_slug: selected.slug, display_name: name.trim() });
        onCreated();
      } catch (err) {
        let key = 'createFailed';
        try {
          const response: { error?: { code?: string } } = JSON.parse(err instanceof Error ? err.message : '');
          if (response.error?.code === 'CONNECTOR_NOT_CONFIGURED') key = 'unconfigured';
          if (response.error?.code === 'MCP_SPACE_NOT_ALLOWED') key = 'accessDenied';
          if (response.error?.code === 'CONNECTOR_EXISTS') key = 'alreadyAdded';
        } catch { /* Network errors use the retry message. */ }
        setError(t(`spaces.connectors.mcp.${key}`));
      } finally {
        setBusy(false);
      }
    }}>
      <McpScope config={selected.mcp} />
      {!unavailable && wrongSpace && <p className="text-sm text-[var(--text-secondary)]">
        {t('spaces.connectors.mcp.wrongSpace', { space: selected.mcp?.allowed_space_id })}
      </p>}
      {alreadyAdded && <p className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.mcp.alreadyAdded')}</p>}
      <Input id={id} label={t('spaces.connectors.mcp.displayName')} value={name}
        onChange={event => setName(event.target.value)} required maxLength={255} disabled={busy || blocked} />
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={blocked || !name.trim()}>
        {t('spaces.connectors.mcp.connect')}
      </Button>
    </form>
  );
}
