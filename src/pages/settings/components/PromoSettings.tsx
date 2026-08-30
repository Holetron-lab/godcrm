import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket, Loader2 } from 'lucide-react';
import { authApi } from '@/features/auth/api/authApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Switch } from '@/shared/components/ui';
import { showToast } from '@/shared/hooks/useToast';

/**
 * ADR-183-A D6 — owner-only toggle for the promo-code field on the signup form.
 * Reads/writes the public `promo_enabled` flag (backed by `_app_settings`).
 * Rendered inside the owner section of the settings page.
 */
export const PromoSettings = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['registration-config'],
    queryFn: async () => {
      const res = await authApi.getRegistrationConfig();
      return res.success ? res.data : null;
    }
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => authApi.setPromoEnabled(enabled),
    onSuccess: (res) => {
      queryClient.setQueryData(['registration-config'], res.success ? res.data : null);
      queryClient.invalidateQueries({ queryKey: ['registration-config'] });
      showToast(t('settings.promo.saved'), 'success');
    },
    onError: () => {
      showToast(t('settings.promo.saveError'), 'error');
    }
  });

  const enabled = data?.promo_enabled === true;

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Ticket className="w-5 h-5 text-primary-500" />
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('settings.promo.title')}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{t('settings.promo.subtitle')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : (
        <Switch
          label={t('settings.promo.toggleLabel')}
          description={t('settings.promo.toggleDescription')}
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(next) => mutation.mutate(next)}
        />
      )}
    </div>
  );
};
