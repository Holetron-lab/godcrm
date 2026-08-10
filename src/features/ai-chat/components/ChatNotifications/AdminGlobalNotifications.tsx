// AdminGlobalNotifications.tsx — ADR-0064 WP-C.
//
// Admin/Global defaults sub-tab. Reads + writes
// GET/PUT /admin/global/chat-notifications. App-owner only (same gate as
// _secrets per ADR-0040). UI gating is hint-only — the server enforces.

import React, { useEffect, useState } from 'react';
import { Loader2, Save, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { NotificationMatrix, type PrefsValue } from './NotificationMatrix';

interface ApiEnvelope<T> { data?: T; success?: boolean }

const EMPTY: PrefsValue = {};

export function AdminGlobalNotifications() {
  const [value, setValue] = useState<PrefsValue>(EMPTY);
  const [initial, setInitial] = useState<PrefsValue>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<ApiEnvelope<{ prefs: PrefsValue }>>(
          '/admin/global/chat-notifications',
        );
        if (cancelled) return;
        const next = res?.data?.prefs ?? EMPTY;
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
      await apiClient.put('/admin/global/chat-notifications', { prefs: value });
      setInitial(value);
      showToast('Глобальный дефолт сохранён', 'success');
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
      <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-[10px] text-amber-300/90">
          Глобальные дефолты применяются ко всем пользователям приложения. Пространства и личные
          настройки могут переопределить эти значения. Доступ — только владелец приложения.
        </p>
      </div>
      <NotificationMatrix value={value} onChange={setValue} triState />
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
