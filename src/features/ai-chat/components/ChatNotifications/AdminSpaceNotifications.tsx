// AdminSpaceNotifications.tsx — ADR-0064 WP-C.
//
// Admin/Space defaults sub-tab. Reads + writes
// GET/PUT /spaces/:id/notification-defaults. Tri-state ON because this layer
// is a *layer*: undeclared keys fall through to global / built-in defaults.

import React, { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { NotificationMatrix, type PrefsValue } from './NotificationMatrix';

interface ApiEnvelope<T> { data?: T; success?: boolean }

interface Props {
  spaceId: number;
  spaceName?: string;
  disabled?: boolean;
}

const EMPTY: PrefsValue = {};

export function AdminSpaceNotifications({ spaceId, spaceName, disabled }: Props) {
  const [value, setValue] = useState<PrefsValue>(EMPTY);
  const [initial, setInitial] = useState<PrefsValue>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await apiClient.get<ApiEnvelope<{ prefs: PrefsValue }>>(
          `/spaces/${spaceId}/notification-defaults`,
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
  }, [spaceId]);

  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  const save = async () => {
    setIsSaving(true);
    try {
      await apiClient.put(`/spaces/${spaceId}/notification-defaults`, { prefs: value });
      setInitial(value);
      showToast('Сохранено', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось сохранить', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const clearAll = () => setValue(EMPTY);

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
        Значения по умолчанию для пространства{spaceName ? ` «${spaceName}»` : ''}. Каждый ключ —
        опционален: <span className="font-mono">↑</span> Inherit означает «использовать глобальный
        дефолт». Личные настройки пользователя имеют приоритет.
      </p>
      <NotificationMatrix value={value} onChange={setValue} triState disabled={disabled} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={isSaving || !dirty || disabled}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Сохранить
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={disabled}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          title="Сбросить все ключи → глобальный дефолт"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Сбросить
        </button>
      </div>
    </div>
  );
}
