// PersonalNotificationSettings.tsx — ADR-0064 WP-C.
//
// Personal/Notifications sub-tab. Reads + writes
// GET/PUT /chat/notification-prefs/personal. Tri-state OFF because Personal
// is the user's full default — no "inherit" makes sense at this layer.

import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { NotificationMatrix, type PrefsValue } from './NotificationMatrix';

const DEFAULT_PREFS: PrefsValue = {
  enabled: true,
  sound_enabled: true,
  sound_volume: 0.6,
  humans: { sound: true, popup: true, badge: true },
  agents: { sound: true, popup: true, badge: true },
};

interface ApiEnvelope<T> { data?: T; success?: boolean }

export function PersonalNotificationSettings() {
  const [value, setValue] = useState<PrefsValue>(DEFAULT_PREFS);
  const [initial, setInitial] = useState<PrefsValue>(DEFAULT_PREFS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<ApiEnvelope<{ prefs: PrefsValue }>>(
          '/chat/notification-prefs/personal',
        );
        if (cancelled) return;
        const next = { ...DEFAULT_PREFS, ...(res?.data?.prefs ?? {}) };
        setValue(next);
        setInitial(next);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  const save = async () => {
    setIsSaving(true);
    try {
      await apiClient.put('/chat/notification-prefs/personal', { prefs: value });
      setInitial(value);
      showToast('Сохранено', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось сохранить', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-tertiary)]">
        Личные настройки уведомлений. Перекрывают значения по умолчанию пространства и приложения,
        но могут быть переопределены настройками отдельного чата.
      </p>
      <NotificationMatrix value={value} onChange={setValue} triState={false} showTestButtons />
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Сохранить
        </button>
      )}
    </div>
  );
}
