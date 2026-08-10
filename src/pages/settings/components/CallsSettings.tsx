/**
 * CallsSettings — owner-only Settings tab for LiveKit voice-call limits.
 * ADR-0059 AMEND-3 §4.9 (cheap subset).
 *
 * Inputs are read-only via the UI until WP-A ships an editable
 * `/owner/calls-settings` PUT endpoint (deferred post-D14 per AMEND-3).
 * Until then the owner edits `.env` and `pm2 restart godcrm --update-env`.
 */

import { useQuery } from '@tanstack/react-query';
import { Phone, Info, Loader2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { Button, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface CallsSettingsResponse {
  maxConcurrent: number;
  maxParticipantsPerRoom: number;
  maxDurationMinutes: number | null;
  retentionDays: number | null;
}

const FALLBACK_DEFAULTS: CallsSettingsResponse = {
  maxConcurrent: 10,
  maxParticipantsPerRoom: 20,
  maxDurationMinutes: null,
  retentionDays: null,
};

async function fetchCallsSettings(): Promise<CallsSettingsResponse> {
  try {
    const resp = await apiClient.get<{ data?: CallsSettingsResponse } & CallsSettingsResponse>(
      '/owner/calls-settings',
    );
    // Endpoint may return either `{data: {...}}` or the bare shape.
    const payload = (resp.data ?? resp) as CallsSettingsResponse;
    return {
      maxConcurrent: payload.maxConcurrent ?? FALLBACK_DEFAULTS.maxConcurrent,
      maxParticipantsPerRoom:
        payload.maxParticipantsPerRoom ?? FALLBACK_DEFAULTS.maxParticipantsPerRoom,
      maxDurationMinutes: payload.maxDurationMinutes ?? null,
      retentionDays: payload.retentionDays ?? null,
    };
  } catch {
    // Endpoint not deployed yet (WP-A in progress) — render defaults so the
    // owner can still see the shape of the eventual form.
    return FALLBACK_DEFAULTS;
  }
}

export const CallsSettings = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const user = useAuthStore((state) => state.user);

  const { data, isLoading } = useQuery({
    queryKey: ['calls-settings'],
    queryFn: fetchCallsSettings,
    staleTime: 60_000,
  });

  if (user?.role !== 'owner') return null;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const cfg = data ?? FALLBACK_DEFAULTS;

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary-500" />
            {t('Звонки', 'Calls')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('Лимиты ёмкости LiveKit для голосовых звонков в чате', 'LiveKit capacity limits for voice calls in chat')}
          </p>
        </div>
      </div>

      {/* Settings grid — 2 enabled + 2 disabled per AMEND-3 §4.9 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('Параллельные комнаты', 'Concurrent rooms')}
          </label>
          <Input
            type="number"
            min={1}
            max={200}
            value={cfg.maxConcurrent}
            readOnly
            className="mt-2"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            Env: <code>CALLS_MAX_CONCURRENT</code> · {t('по умолчанию 10', 'default 10')}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('Участников в комнате', 'Participants per room')}
          </label>
          <Input
            type="number"
            min={1}
            max={200}
            value={cfg.maxParticipantsPerRoom}
            readOnly
            className="mt-2"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            Env: <code>CALLS_MAX_PARTICIPANTS_PER_ROOM</code> · {t('по умолчанию 20', 'default 20')}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]/40 border border-dashed border-[var(--border-secondary)]">
          <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('Максимальная длительность звонка (мин)', 'Maximum call duration (min)')}
          </label>
          <Input
            type="text"
            value=""
            placeholder="coming soon"
            disabled
            className="mt-2 cursor-not-allowed"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            {t('Запланировано после D14 (2026-05-18)', 'Planned after D14 (2026-05-18)')}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]/40 border border-dashed border-[var(--border-secondary)]">
          <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
            {t('Хранение записей (дни)', 'Recording retention (days)')}
          </label>
          <Input
            type="text"
            value=""
            placeholder="coming soon"
            disabled
            className="mt-2 cursor-not-allowed"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            {t('Запланировано после D14 (2026-05-18)', 'Planned after D14 (2026-05-18)')}
          </p>
        </div>
      </div>

      {/* Info box */}
      <div className="mt-4 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-start gap-2">
        <Info className="h-4 w-4 text-primary-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-primary-600 dark:text-primary-400">
          {t('Пока лимиты редактируются через', 'For now limits are edited via')} <code>.env</code>:{' '}
          {t('после изменения значений нужно выполнить', 'after changing values you need to run')}{' '}
          <code>pm2 restart godcrm --update-env</code>.{' '}
          {t('После D14 (2026-05-18) поля станут редактируемыми из этого экрана.', 'After D14 (2026-05-18) the fields will become editable from this screen.')}
        </p>
      </div>

      {/* Disabled Save button — read-only until WP-A PUT endpoint ships */}
      <div className="flex justify-end mt-6">
        <Button
          variant="primary"
          disabled
          title="Edit via .env until 2026-05-19"
        >
          {t('Сохранить', 'Save')}
        </Button>
      </div>
    </div>
  );
};
