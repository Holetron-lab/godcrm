import { useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Switch } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { MailMessageType, MailSettings } from '../settings';
import { MailLibrarySettings } from './MailLibrarySettings';
import { MailLabelsManager } from './MailLabelsManager';
import { MailAccountsSettings } from './MailAccountsSettings';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MailSettingsPanelProps {
  settings: MailSettings;
  onChange: (next: MailSettings) => void;
  /** Scope for the label manager and the accounts list. */
  spaceId: number | undefined;
  /** «Аккаунты и импорт»: the mailbox in use + the connect modal opener. */
  activeAccountId: number | null;
  onConnect: () => void;
  /** Which tab to open on. Defaults to "Общие". */
  initialTab?: TabId;
  /** Open the "Ярлыки" tab straight into a fresh label draft (rail "+"). */
  autoNewLabel?: boolean;
  /** Close the settings surface and return to the message list. */
  onClose: () => void;
}

// Gmail's settings tabs. Only "Общие" is wired to real behaviour today; the rest
// are surfaced (for parity + discoverability) but honestly marked as pending
// their backend, rather than shipped as toggles that silently do nothing.
// Labels come from `mail.settings.tabs.<id>`.
const TABS = [
  { id: 'general', ready: true },
  { id: 'templates', ready: true },
  { id: 'signatures', ready: true },
  { id: 'labels', ready: true },
  { id: 'inbox', ready: false },
  { id: 'accounts', ready: true },
  { id: 'filters', ready: false },
  { id: 'forwarding', ready: false },
  { id: 'advanced', ready: false },
] as const;

type TabId = (typeof TABS)[number]['id'];

const TYPE_ORDER: MailMessageType[] = ['incoming', 'outgoing', 'archive'];

/**
 * ADR-158 — mail Settings surface. Renders in-place inside the mail content area
 * (where the message list / reading pane live), Gmail-style, instead of a modal
 * overlay. The gear in the top toolbar opens it; the back button closes it. The
 * General tab holds the client-side view/interaction prefs that actually drive
 * the module today (see `settings.ts`).
 */
export function MailSettingsPanel({
  settings,
  onChange,
  spaceId,
  activeAccountId,
  onConnect,
  initialTab = 'general',
  autoNewLabel = false,
  onClose,
}: MailSettingsPanelProps) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<TabId>(initialTab);

  // Patch helpers — always emit a fresh object so MailPage's effect persists it.
  const set = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) =>
    onChange({ ...settings, [key]: value });
  const setColor = (type: MailMessageType, color: string) =>
    onChange({ ...settings, typeColors: { ...settings.typeColors, [type]: color } });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      {/* Header — title + close, mirroring the reading pane's toolbar height. */}
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2">
        <button
          type="button"
          aria-label={t('mail.settings.backToMail')}
          title={t('mail.settings.back')}
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('mail.settings.title')}</h2>
        <button
          type="button"
          aria-label={t('mail.settings.closeSettings')}
          title={t('mail.common.close')}
          onClick={onClose}
          className="ml-auto rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body — tab strip + panel, scrolls within the content area. */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4 max-md:flex-col max-md:gap-2">
        {/* Left tab strip (top strip on mobile). */}
        <nav
          className="flex w-52 flex-shrink-0 flex-col gap-0.5 max-md:w-full max-md:flex-row max-md:overflow-x-auto"
          aria-label={t('mail.settings.sections')}
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors max-md:flex-shrink-0',
                tab === item.id
                  ? 'bg-[var(--bg-tertiary)] font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              <span className="whitespace-nowrap">{t(`mail.settings.tabs.${item.id}`)}</span>
              {!item.ready && (
                <span className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                  {t('mail.settings.soon')}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Panel. */}
        <div className="min-w-0 flex-1 border-l border-[var(--border-primary)] pl-4 max-md:border-l-0 max-md:border-t max-md:pl-0 max-md:pt-3">
          {tab === 'general' ? (
            <div className="flex max-w-2xl flex-col gap-5">
              <Switch
                label={t('mail.settings.hoverActions')}
                description={t('mail.settings.hoverActionsHint')}
                checked={settings.hoverActions}
                onCheckedChange={(v) => set('hoverActions', v)}
              />
              <Switch
                label={t('mail.settings.snippets')}
                description={t('mail.settings.snippetsHint')}
                checked={settings.showSnippets}
                onCheckedChange={(v) => set('showSnippets', v)}
              />
              <Switch
                label={t('mail.settings.hotkeys')}
                description={t('mail.settings.hotkeysHint')}
                checked={settings.hotkeys}
                onCheckedChange={(v) => set('hotkeys', v)}
              />

              <div className="border-t border-[var(--border-primary)] pt-4">
                <Switch
                  label={t('mail.settings.typeIndicators')}
                  description={t('mail.settings.typeIndicatorsHint')}
                  checked={settings.typeIndicators}
                  onCheckedChange={(v) => set('typeIndicators', v)}
                />

                {settings.typeIndicators && (
                  <div className="mt-3 flex flex-col gap-2 pl-1">
                    {TYPE_ORDER.map((type) => (
                      <label
                        key={type}
                        className="flex items-center justify-between gap-4 text-sm text-[var(--text-secondary)]"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-4 w-1 rounded-full"
                            style={{ backgroundColor: settings.typeColors[type] }}
                          />
                          {t(`mail.types.${type}`)}
                        </span>
                        <input
                          type="color"
                          aria-label={t('mail.settings.typeColor', { label: t(`mail.types.${type}`) })}
                          value={settings.typeColors[type]}
                          onChange={(e) => setColor(type, e.target.value)}
                          className="h-7 w-12 cursor-pointer rounded border border-[var(--border-primary)] bg-transparent p-0.5"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'templates' ? (
            <MailLibrarySettings section="templates" />
          ) : tab === 'signatures' ? (
            <MailLibrarySettings section="signatures" />
          ) : tab === 'labels' ? (
            <MailLabelsManager spaceId={spaceId} autoNew={autoNewLabel} />
          ) : tab === 'accounts' ? (
            <MailAccountsSettings spaceId={spaceId} activeAccountId={activeAccountId} onConnect={onConnect} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                {t('mail.settings.pendingTitle')}
              </p>
              <p className="max-w-xs text-xs text-[var(--text-tertiary)]">
                {t('mail.settings.pendingHint')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
