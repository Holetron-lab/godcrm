// PerChatSettingsInline.tsx — ADR-0064 §Per-chat override surface.
//
// Tabbed inline panel rendered below BoundRowsStrip in the chat area.
// Holds all per-conversation settings (currently Notifications + Participants).
// Replaces the earlier PerChatNotificationsInline (notifications-only).

import React, { useEffect, useState } from 'react';
import {
  Bell,
  Users,
  X,
  Loader2,
  Save,
  RotateCcw,
  UserPlus,
  UserMinus,
  Sliders,
} from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import { cn } from '@/shared/utils/cn';
import { NotificationMatrix, type PrefsValue } from './NotificationMatrix';
import { ParticipantSelector, type Participant } from '../ParticipantSelector';

export type PerChatSettingsTab = 'notifications' | 'participants';

interface Props {
  conversationId: number;
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
  conversationTitle,
  initialTab = 'notifications',
  currentUserId,
  onClose,
}: Props) {
  const [tab, setTab] = useState<PerChatSettingsTab>(initialTab);
  // Sync if the parent reopens with a different intent (e.g. user clicks
  // "Участники" while inline is already open on Notifications).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-secondary)] bg-gradient-to-r from-[var(--color-primary-500)]/5 to-transparent">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sliders className="w-3.5 h-3.5 text-[var(--color-primary-500)] flex-shrink-0" />
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            Настройки чата{conversationTitle ? ` — ${conversationTitle}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Закрыть"
          className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex-shrink-0 flex border-b border-[var(--border-secondary)]">
        <TabButton
          active={tab === 'notifications'}
          onClick={() => setTab('notifications')}
          icon={<Bell className="w-3 h-3" />}
          label="Уведомления"
          accent="red"
        />
        <TabButton
          active={tab === 'participants'}
          onClick={() => setTab('participants')}
          icon={<Users className="w-3 h-3" />}
          label="Участники"
          accent="blue"
        />
      </div>

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
      showToast('Настройки чата сохранены', 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось сохранить', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    setIsSaving(true);
    try {
      await apiClient.delete(`/chat/notification-prefs/conversation/${conversationId}`);
      showToast('Сброшено к личным настройкам', 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось сбросить', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
          Переопределяют ваши личные настройки. <span className="font-mono">↑</span> Inherit —
          использовать значение личного слоя.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Загрузка текущих настроек…
          </div>
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
          title="Удалить override и вернуться к личным настройкам"
        >
          <RotateCcw className="w-3 h-3" />
          Сброс
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || isLoading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Сохранить
        </button>
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
      const r = await apiClient.get<any>(`/chat/conversations/${conversationId}?limit=1`);
      const conv = (r as any)?.data ?? r;
      setParticipants(Array.isArray(conv?.participants) ? conv.participants : []);
      const owner = conv?.created_by ?? conv?.owner_id ?? null;
      setOwnerId(owner != null ? Number(owner) : null);
    } catch (err) {
      logger.warn('[PerChatSettings/participants] load failed:', err);
      showToast(err instanceof Error ? err.message : 'Не удалось загрузить участников', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = currentUserId != null && ownerId != null && Number(currentUserId) === ownerId;

  const handleAdd = async (p: Participant) => {
    if (p.type !== 'user') {
      showToast('Добавление агентов пока недоступно — используйте /<<@slug>>', 'info');
      return;
    }
    if (participants.some((x) => x.user_id === p.id)) {
      showToast('Уже участник', 'info');
      return;
    }
    setIsAdding(true);
    try {
      await apiClient.post(`/chat/conversations/${conversationId}/participants`, {
        user_id: p.id,
        role: 'member',
      });
      showToast(`${p.name} добавлен`, 'success');
      setShowPicker(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось добавить', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (userId: number, name: string) => {
    if (!confirm(`Удалить ${name} из чата?`)) return;
    setBusyUserId(userId);
    try {
      await apiClient.delete(`/chat/conversations/${conversationId}/participants/${userId}`);
      showToast(`${name} удалён`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось удалить', 'error');
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
          Загрузка участников…
        </div>
      ) : (
        <>
          <div className="space-y-1 mb-2">
            {participants.length === 0 && (
              <div className="text-xs text-[var(--text-tertiary)] py-2">Нет участников.</div>
            )}
            {participants.map((p) => {
              const isSelf = currentUserId != null && p.user_id === Number(currentUserId);
              const isConvOwner = ownerId != null && p.user_id === ownerId;
              const canRemove = !isConvOwner && (isOwner || isSelf);
              const isBusy = busyUserId === p.user_id;
              return (
                <div
                  key={p.user_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]/40"
                >
                  {p.avatar_url ? (
                    <img
                      src={p.avatar_url}
                      alt={p.name}
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text-primary)] truncate">
                      {p.name}
                      {isSelf && <span className="text-[var(--text-tertiary)]"> (вы)</span>}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                      {p.role === 'owner' || isConvOwner ? 'Владелец' : p.role || 'участник'}
                      {p.email ? ` · ${p.email}` : ''}
                    </div>
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => handleRemove(p.user_id, p.name)}
                      disabled={isBusy}
                      title={isSelf ? 'Покинуть чат' : 'Удалить из чата'}
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
                placeholder="Найти пользователя…"
              />
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2 py-0.5"
                >
                  Отмена
                </button>
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
              Добавить участника
            </button>
          )}

          <p className="text-[10px] text-[var(--text-tertiary)] mt-2 leading-relaxed">
            Блокировка пока недоступна — нет API. Покинуть чат можно через значок{' '}
            <UserMinus className="inline w-3 h-3 align-text-bottom" /> на своей строке.
          </p>
        </>
      )}
    </div>
  );
}

export default PerChatSettingsInline;
