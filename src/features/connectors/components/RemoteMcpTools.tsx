import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/components/ui/Button';
import { Checkbox } from '@/shared/components/ui/Checkbox';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { connectorsApi, type McpTool, type SpaceConnector } from '../api/connectorsApi';

export function RemoteMcpTools({ connector, spaceId, disabled, busy, onBusyChange }: {
  connector: SpaceConnector; spaceId: number; disabled: boolean;
  busy: string | null; onBusyChange: (action: 'discover' | 'save' | null) => void;
}) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const persisted = connector.custom_definition?.allowed_tools;
  const approved = Array.isArray(persisted) ? persisted.filter((name): name is string => typeof name === 'string') : [];
  const [selected, setSelected] = useState<string[]>(approved);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  if (connector.status === 'revoked') return null;

  return <div className="space-y-3">
    <p className="text-xs text-[var(--text-secondary)]">{t('spaces.connectors.remote.permissionsHint')}</p>
    <Button type="button" variant="secondary" size="sm" disabled={disabled || busy !== null} loading={busy === 'discover'}
      onClick={async () => {
        onBusyChange('discover'); setError(false); setSaved(false);
        try { setTools(await connectorsApi.discoverTools(spaceId, connector.id)); }
        catch { setError(true); }
        finally { onBusyChange(null); }
      }}>{t('spaces.connectors.remote.discover')}</Button>
    {(tools !== null || approved.length > 0) && <fieldset disabled={disabled || busy !== null} className="space-y-2 min-w-0">
      <legend className="text-sm text-[var(--text-primary)]">{t('spaces.connectors.remote.permissions')}</legend>
      {tools?.length === 0 && <p className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.remote.noTools')}</p>}
      {Array.from(new Set([...approved, ...(tools ?? []).map(tool => tool.name)])).map(name => (
        <div key={name} className="break-words [overflow-wrap:anywhere]">
          <Checkbox label={name} checked={selected.includes(name)} disabled={disabled || busy !== null || (!selected.includes(name) && selected.length >= 100)}
            onCheckedChange={checked => {
              setSaved(false);
              setSelected(names => checked === true ? [...names, name] : names.filter(item => item !== name));
            }} />
          {tools?.find(tool => tool.name === name)?.description && <p className="pl-8 text-xs text-[var(--text-secondary)]">{tools.find(tool => tool.name === name)?.description}</p>}
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" disabled={disabled || busy !== null} loading={busy === 'save'}
        onClick={async () => {
          onBusyChange('save'); setError(false); setSaved(false);
          try {
            const updated = await connectorsApi.setAllowedTools(spaceId, connector.id, selected);
            client.setQueryData<SpaceConnector[]>(['connectors', 'list', spaceId], rows => rows?.map(row => row.id === updated.id ? updated : row));
            setSaved(true);
          } catch { setError(true); }
          finally { onBusyChange(null); }
        }}>{t('spaces.connectors.remote.saveTools')}</Button>
    </fieldset>}
    {saved && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.remote.savedTools')}</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('spaces.connectors.remote.toolsFailed')}</p>}
  </div>;
}
