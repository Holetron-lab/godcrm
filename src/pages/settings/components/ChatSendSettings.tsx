import { useChatSendShortcut, type ChatDevice } from '@/shared/hooks/useChatSendShortcut';
import { useChatInputMode } from '@/shared/hooks/useChatInputMode';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function ChatSendSettings() {
  const { t } = useLanguage();
  const { preferences, setMode, error } = useChatSendShortcut();
  const input = useChatInputMode();
  return (
    <fieldset className="space-y-3 md:col-span-2">
      <legend className="text-sm font-medium text-[var(--text-secondary)]">{t('settings.chatSend.title')}</legend>
      <p id="chat-send-help" className="text-xs text-[var(--text-secondary)]">{t('settings.chatSend.hint')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(['desktop', 'mobile'] as ChatDevice[]).map(device => (
          <div key={device} className="space-y-2 text-sm text-[var(--text-secondary)]">
            <label htmlFor={`chat-send-${device}`} className="block">{t(`settings.chatSend.${device}`)}</label>
            <select
              id={`chat-send-${device}`}
              value={preferences[device]}
              onChange={event => setMode(device, event.target.value === 'enter' ? 'enter' : 'shift-enter')}
              aria-describedby={`chat-send-help chat-newline-${device}`}
              className="w-full min-w-0 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
            >
              <option value="shift-enter">{t('settings.chatSend.shift-enter')}</option>
              <option value="enter">{t('settings.chatSend.enter')}</option>
            </select>
            <span id={`chat-newline-${device}`} className="block text-xs text-[var(--text-secondary)]">{t(`settings.chatSend.newline-${preferences[device]}`)}</span>
          </div>
        ))}
      </div>
      <div className="space-y-2 text-sm text-[var(--text-secondary)]">
        <label htmlFor="chat-input-mode" className="block">{t('settings.chatInput.title')}</label>
        <select id="chat-input-mode" value={input.mode}
          onChange={event => input.setMode(event.target.value === 'per-chat' ? 'per-chat' : 'shared')}
          aria-describedby="chat-input-help"
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]">
          <option value="shared">{t('settings.chatInput.shared')}</option>
          <option value="per-chat">{t('settings.chatInput.perChat')}</option>
        </select>
        <p id="chat-input-help" className="text-xs">{t('settings.chatInput.hint')}</p>
      </div>
      {(error || input.error) && <p role="alert" className="text-sm text-red-500">{t('settings.chatSend.saveError')}</p>}
    </fieldset>
  );
}
