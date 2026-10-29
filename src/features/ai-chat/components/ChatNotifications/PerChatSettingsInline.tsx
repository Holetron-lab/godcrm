import { useLanguage } from '@/shared/i18n/LanguageContext';
// PerChatSettingsInline.tsx — ADR-0064 §Per-chat override surface.
//
// Tabbed inline panel rendered below BoundRowsStrip in the chat area.
// Holds all per-conversation settings (currently Notifications + Participants).
// Replaces the earlier PerChatNotificationsInline (notifications-only).

import React, { useEffect, useState } from 'react';
import {
  Settings,
  Bell,
  Users,
  X,
  Loader2,
  Save,
  RotateCcw,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import { cn } from '@/shared/utils/cn';
import { NotificationMatrix, type PrefsValue } from './NotificationMatrix';
import { ParticipantSelector, type Participant } from '../ParticipantSelector';

import { ConversationSpaceSetting } from '../AIChatPanel/components/ConversationSpace';
import type { useConversationSpace } from '../AIChatPanel/hooks/useConversationSpace';

export type PerChatSettingsTab = 'settings' | 'notifications' | 'participants';

interface Props {
  conversationId: number;
  conversationSpace?: ReturnType<typeof useConversationSpace>;
  conversationTitle?: string | null;
  initialTab?: PerChatSettingsTab;
  /** Current viewer id — used to gate Remove buttons. */
  currentUserId?: number | null;
  onClose: () => void;
}

const EMPTY: PrefsValue = {};

function pruneEmpty(v: PrefsValue): PrefsValue {
  const out: PrefsValue = {};
  if (v.enabled !== null && v.enabled !== undefined) out.enabled = v.enabled;
  if (v.sound_enabled !== null && v.sound_enabled !== undefined) out.sound_enabled = v.sound_enabled;
  if (typeof v.sound_volume === 'number') out.sound_volume = v.sound_volume;
  for (const block of ['humans', 'agents'] as const) {
    const b = v[block];
    if (!b) continue;
    const cleaned: Record<string, boolean> = {};
    for (const k of ['sound', 'popup', 'badge'] as const) {
      if (b[k] !== null && b[k] !== undefined) cleaned[k] = b[k] as boolean;
    }
    if (Object.keys(cleaned).length) out[block] = cleaned;
  }
  return out;
}

export function PerChatSettingsInline({
  conversationId,
  conversationSpace,
  initialTab = 'notifications',
  currentUserId,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<PerChatSettingsTab>(initialTab);
  // Sync if the parent reopens with a different intent (e.g. user clicks
  // "Участники" while inline is already open on Notifications).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Tab strip */}
      <div className="flex-shrink-0 flex border-b border-[var(--border-secondary)]">
        {conversationSpace && <TabButton
          active={tab === 'settings'} onClick={() => setTab('settings')}
          icon={<Settings className="w-3 h-3" />} label={t('aiChat.ui.settings')} accent="blue"
        />}
        <TabButton
          active={tab === 'notifications'}
          onClick={() => setTab('notifications')}
          icon={<Bell className="w-3 h-3" />}
          label={t('statusBar.notifications')}
          accent="red"
        />
        <TabButton
          active={tab === 'participants'}
          onClick={() => setTab('participants')}
          icon={<Users className="w-3 h-3" />}
          label={t('aiChat.ui.participants')}
          accent="blue"
        />
        <button type="button" onClick={onClose} aria-label={t('aiChat.ui.close')} className="px-3 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] focus-visible:ring-2">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {tab === 'settings' && conversationSpace && (
        <div className="overflow-y-auto px-3 py-2"><ConversationSpaceSetting binding={conversationSpace} /></div>
      )}
      {tab === 'notifications' && (
        <NotificationsBody conversationId={conversationId} onClose={onClose} />
      )}
      {tab === 'participants' && (
        <ParticipantsBody conversationId={conversationId} currentUserId={currentUserId} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: 'red' | 'blue';
}) {
  const activeColor = accent === 'red' ? 'text-red-500 border-red-500' : 'text-blue-500 border-blue-500';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 py-1.5 text-[11px] font-medium transition-colors flex items-center justify-center gap-1 border-b-2',
        active
          ? activeColor
          : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)]',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Notifications tab body ──────────────────────────────────────────────
function NotificationsBody({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState<PrefsValue>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setValue(EMPTY);
    apiClient
      .get<{ data?: { prefs: PrefsValue | null } } | { prefs: PrefsValue | null }>(
        `/chat/notification-prefs/conversation/${conversationId}`,
      )
      .then((r) => {
        if (cancelled) return;
        const prefs =
          (r as { data?: { prefs: PrefsValue | null } }).data?.prefs ??
          (r as { prefs: PrefsValue | null }).prefs ??
          null;
        setValue(prefs ?? EMPTY);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('[PerChatSettings/notifications] load failed:', err);
        setValue(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const save = async () => {
    setIsSaving(true);
    try {
      await apiClient.put(`/chat/notification-prefs/conversation/${conversationId}`, {
        prefs: pruneEmpty(value),
      });
      showToast(t('aiChat.ui.chatSettingsSaved'), 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('aiChat.ui.couldNotSave'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    setIsSaving(true);
    try {
      await apiClient.delete(`/chat/notification-prefs/conversation/${conversationId}`);
      showToast(t('aiChat.ui.resetToPersonalSettings'), 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('aiChat.ui.couldNotReset'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
          {t('aiChat.ui.overrideYourPersonalSettings')}<span className="font-mono">↑</span> {t('aiChat.ui.inheritPersonalHelp')}
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('aiChat.ui.loadingCurrentSettings')}</div>
        ) : (
          <NotificationMatrix value={value} onChange={setValue} triState disabled={isSaving} />
        )}
      </div>

      <div className="flex-shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/30">
        <button
          type="button"
          onClick={reset}
          disabled={isSaving || isLoading}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          title={t('aiChat.ui.removeOverridesAndReturnToPersonalSettings')}
        >
          <RotateCcw className="w-3 h-3" />
          {t('aiChat.ui.reset')}</button>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || isLoading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {t('aiChat.ui.save')}</button>
      </div>
    </>
  );
}

// ─── Participants tab body ───────────────────────────────────────────────

interface ServerParticipant {
  user_id: number;
  role: string;
  user_type?: string | null;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
  icon?: string | null;
  color?: string | null;
  agent_icon?: string | null;
  agent_color?: string | null;
  joined_at?: string | null;
  last_read_at?: string | null;
}

function ParticipantsBody({
  conversationId,
  currentUserId,
}: {
  conversationId: number;
  currentUserId?: number | null;
}) {
  const { t } = useLanguage();
  const [participants, setParticipants] = useState<ServerParticipant[]>([]);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      // limit=1 keeps payload light — we only care about .participants and owner.
      const r = await apiClient.get<{ data: { participants?: ServerParticipant[]; created_by?: number; owner_id?: number } }>(`/chat/conversations/${conversationId}?limit=1`);
      const conv = r.data;
      setParticipants(Array.isArray(conv?.participants) ? conv.participants : []);
      const owner = conv?.created_by ?? conv?.owner_id ?? null;
      setOwnerId(owner != null ? Number(owner) : null);
    } catch (err) {
      logger.warn('[PerChatSettings/participants] load failed:', err);
      showToast(err instanceof Error ? err.message : t('aiChat.ui.couldNotLoadParticipants'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = currentUserId != null && ownerId != null && Number(currentUserId) === ownerId;

  const handleAdd = async (p: Participant) => {
    if (p.type !== 'user') {
      showToast(t('aiChat.ui.addingAgentsIsNotAvailableYetUseSlug'), 'info');
      return;
    }
    if (participants.some((x) => x.user_id === p.id)) {
      showToast(t('aiChat.ui.alreadyAParticipant'), 'info');
      return;
    }
    setIsAdding(true);
    try {
      await apiClient.post(`/chat/conversations/${conversationId}/participants`, {
        user_id: p.id,
        role: 'member',
      });
      showToast(t('aiChat.ui.participantAdded', { name: p.name }), 'success');
      setShowPicker(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('aiChat.ui.couldNotAdd'), 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (userId: number, name: string) => {
    if (!confirm(t('aiChat.ui.removeParticipantConfirm', { name: name }))) return;
    setBusyUserId(userId);
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}/participants/${userId}`);
      showToast(t('aiChat.ui.participantRemoved', { name: name }), 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('aiChat.ui.couldNotRemove'), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const excludeUserIds = participants.map((p) => p.user_id);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('aiChat.ui.loadingParticipants')}</div>
      ) : (
        <>
          <div role="list" className="space-y-1 mb-2">
            {participants.length === 0 && (
              <div className="text-xs text-[var(--text-tertiary)] py-2">{t('aiChat.ui.noParticipants')}</div>
            )}
            {participants.map((p) => {
              const isSelf = currentUserId != null && p.user_id === Number(currentUserId);
              const isConvOwner = ownerId != null && p.user_id === ownerId;
              const canRemove = !isConvOwner && (isOwner || isSelf);
              const isBusy = busyUserId === p.user_id;
              const color = p.color || p.agent_color || "var(--color-primary-500)";
              return (
                <div
                  key={p.user_id}
                  role="listitem"
                  style={{ boxShadow: `inset 4px 0 0 0 ${color}` }}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--bg-tertiary)]/40"
                >
                  <Avatar url={p.avatar_url} emoji={p.icon || p.agent_icon || (p.avatar_url && !/^(https?:|data:|\/)/.test(p.avatar_url) ? p.avatar_url : undefined)} name={p.name} color={p.color || p.agent_color} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text-primary)] truncate">
                      {p.name}
                      {isSelf && <span className="text-[var(--text-tertiary)]"> {t('aiChat.ui.youLabel')}</span>}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                      {p.role === 'owner' || isConvOwner ? t('userAccess.roles.owner') : p.role || t('aiChat.ui.participantRole')}
                      {p.email ? ` · ${p.email}` : ''}
                    </div>
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleRemove(p.user_id, p.name)}
                      disabled={isBusy}
                      title={isSelf ? t('aiChat.ui.leaveChat') : t('aiChat.ui.removeFromChat')}
                      className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserMinus className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {showPicker ? (
            <div className="border border-[var(--border-secondary)] rounded p-2 bg-[var(--bg-tertiary)]/30">
              <ParticipantSelector
                showAgents={false}
                showUsers
                filterType="user"
                excludeIds={{ users: excludeUserIds }}
                onSelect={handleAdd}
                placeholder={t('aiChat.ui.findAUser')}
              />
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2 py-0.5"
                >
                  {t('aiChat.ui.cancel')}</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              disabled={isAdding}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-[var(--text-secondary)] border border-dashed border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/5 disabled:opacity-40"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('aiChat.ui.addParticipantLabel')}</button>
          )}

          <p className="text-[10px] text-[var(--text-tertiary)] mt-2 leading-relaxed">
            {t('aiChat.ui.leaveInsteadOfBlock')}{' '}
            <UserMinus className="inline w-3 h-3 align-text-bottom" />
          </p>
        </>
      )}
    </div>
  );
}

export default PerChatSettingsInline;
