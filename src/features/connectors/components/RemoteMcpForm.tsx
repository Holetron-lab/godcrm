import { useId, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { connectorsApi, type CatalogueType } from '../api/connectorsApi';

export const isRemoteMcp = (slug: string) => ['custom_mcp', 'custom_blender_mcp', 'custom_godcrm_mcp'].includes(slug);

export function RemoteMcpForm({ spaceId, selected, onCreated }: {
  spaceId: number; selected: CatalogueType; onCreated: () => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [name, setName] = useState(selected.display_name);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <form className="space-y-3 p-4" onSubmit={async event => {
    event.preventDefault();
    if (busy || !name.trim() || !event.currentTarget.checkValidity()) return;
    setBusy(true);
    setError(false);
    try {
      await connectorsApi.createMcp(spaceId, {
        type_slug: selected.slug, display_name: name.trim(),
        fields: { url: url.trim(), ...(token ? { bearer_token: token } : {}) }, allowed_tools: [],
      });
      setToken('');
      onCreated();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }}>
    <p className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.remote.httpsHint')}</p>
    {selected.slug === 'custom_blender_mcp' && <p className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.remote.blenderHint')}</p>}
    {selected.slug === 'custom_godcrm_mcp' && <p className="text-sm text-[var(--text-secondary)]">{t('spaces.connectors.remote.godcrmHint')}</p>}
    <Input id={`${id}-name`} label={t('spaces.connectors.mcp.displayName')} value={name}
      onChange={event => setName(event.target.value)} required maxLength={200} disabled={busy} />
    <Input id={`${id}-url`} label={t('spaces.connectors.remote.url')} type="url" pattern="https://.*" required maxLength={2048}
      value={url} onChange={event => setUrl(event.target.value)} disabled={busy} autoComplete="off" />
    <Input id={`${id}-token`} label={t('spaces.connectors.remote.token')} type="password" autoComplete="new-password"
      value={token} onChange={event => setToken(event.target.value)} disabled={busy} maxLength={8192} />
    <p className="text-xs text-[var(--text-secondary)]">{t('spaces.connectors.remote.secretHint')}</p>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('spaces.connectors.remote.createFailed')}</p>}
    <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={busy || !name.trim()}>
      {t('spaces.connectors.remote.save')}
    </Button>
  </form>;
}
