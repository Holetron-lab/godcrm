import React, { lazy, Suspense } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { PerChatSettingsTab } from '../../ChatNotifications/PerChatSettingsInline';
import type { useAIChatPanelLogic } from './useAIChatPanelLogic';

const PerChatSettingsInline = lazy(() => import('../../ChatNotifications/PerChatSettingsInline').then(m => ({ default: m.PerChatSettingsInline })));

type ConversationSettingsOptions = Pick<ReturnType<typeof useAIChatPanelLogic>,
  'userConversationId' | 'currentConversationId' | 'activePanel' | 'setActivePanel' |
  'isWideMode' | 'conversationSpace' | 'currentUser'>;

export function useConversationSettings({
  userConversationId, currentConversationId, activePanel, setActivePanel,
  isWideMode, conversationSpace, currentUser,
}: ConversationSettingsOptions) {
  const { t } = useLanguage();
  const [chatSettings, setChatSettings] = React.useState<{ id: number; tab: PerChatSettingsTab } | null>(null);
  const selectedConversationId = userConversationId || currentConversationId;
  const chatSettingsRef = React.useRef<HTMLDivElement>(null);
  const settingsOpenerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (chatSettings && chatSettings.id !== selectedConversationId) {
      setChatSettings(null);
      setActivePanel('none');
    }
  }, [selectedConversationId, chatSettings, setActivePanel]);
  React.useEffect(() => {
    if (activePanel !== 'settings') setChatSettings(null);
  }, [activePanel]);
  React.useEffect(() => {
    if (chatSettings && activePanel === 'settings') chatSettingsRef.current?.focus();
  }, [chatSettings, activePanel, isWideMode]);
  const openChatSettings = (tab: PerChatSettingsTab) => {
    if (!selectedConversationId) return;
    const active = document.activeElement;
    const triggerId = active?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
    settingsOpenerRef.current = triggerId ? document.getElementById(triggerId)
      : active instanceof HTMLElement ? active : null;
    setChatSettings({ id: selectedConversationId, tab });
    setActivePanel('settings');
  };
  const closeChatSettings = () => {
    setChatSettings(null);
    setActivePanel('none');
    settingsOpenerRef.current?.focus();
  };
  const conversationSettings = chatSettings && chatSettings.id === selectedConversationId ? (
    // Escape dismisses this focusable region without giving it modal semantics.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div ref={chatSettingsRef} role="region" aria-label={t('aiChat.ui.chatSettings')} tabIndex={-1}
      className="flex min-h-0 flex-col h-full focus:outline-none"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeChatSettings();
        }
      }}>
      <Suspense fallback={<p role="status" className="p-3">{t('common.loading')}</p>}>
        <PerChatSettingsInline key={chatSettings.id} conversationId={chatSettings.id} initialTab={chatSettings.tab}
          conversationSpace={conversationSpace} currentUserId={currentUser?.id ? Number(currentUser.id) : null}
          onClose={closeChatSettings} />
      </Suspense>
    </div>
  ) : null;

  return { chatSettings, setChatSettings, selectedConversationId, openChatSettings, conversationSettings };
}
