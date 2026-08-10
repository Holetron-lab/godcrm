import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, AlertTriangle, Loader2, Check, Info } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button, Input } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';

interface RateLimitConfig {
  auth_max_attempts: number;
  auth_window_minutes: number;
  global_max_requests: number;
  global_window_minutes: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  auth_max_attempts: 10,
  auth_window_minutes: 15,
  global_max_requests: 1000,
  global_window_minutes: 15
};

const RECOMMENDED_CONFIG: RateLimitConfig = {
  auth_max_attempts: 10,
  auth_window_minutes: 15,
  global_max_requests: 1000,
  global_window_minutes: 15
};

export const RateLimitSettings = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  
  const [config, setConfig] = useState<RateLimitConfig>(DEFAULT_CONFIG);
  const [showWarning, setShowWarning] = useState(false);

  // Only owner can see this
  if (user?.role !== 'owner') {
    return null;
  }

  const { isLoading } = useQuery({
    queryKey: ['rate-limit-config'],
    queryFn: async () => {
      try {
        const response = await apiClient.request<{ data: RateLimitConfig }>('/system/rate-limit-config');
        if (response.data) {
          setConfig(response.data);
          return response.data;
        }
      } catch {
        // Use defaults if not configured
      }
      return DEFAULT_CONFIG;
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (newConfig: RateLimitConfig) => {
      return apiClient.request('/system/rate-limit-config', {
        method: 'PUT',
        body: JSON.stringify(newConfig)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-limit-config'] });
      setShowWarning(false);
    }
  });

  const handleChange = (field: keyof RateLimitConfig, value: string) => {
    const numValue = parseInt(value) || 0;
    setConfig(prev => ({ ...prev, [field]: numValue }));
    
    // Show warning if increasing limits
    if (field === 'auth_max_attempts' && numValue > RECOMMENDED_CONFIG.auth_max_attempts) {
      setShowWarning(true);
    }
  };

  const handleSave = () => {
    updateMutation.mutate(config);
  };

  const handleResetToRecommended = () => {
    setConfig(RECOMMENDED_CONFIG);
    setShowWarning(false);
  };

  const isModified = JSON.stringify(config) !== JSON.stringify(RECOMMENDED_CONFIG);
  const isAboveRecommended = config.auth_max_attempts > RECOMMENDED_CONFIG.auth_max_attempts;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary-500" />
            Rate Limiting
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('rateLimitSettings.subtitle')}
          </p>
        </div>
        {isModified && (
          <Button variant="secondary" size="sm" onClick={handleResetToRecommended}>
            {t('rateLimitSettings.reset')}
          </Button>
        )}
      </div>

      {/* Warning banner */}
      {(showWarning || isAboveRecommended) && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              ⚠️ {t('rateLimitSettings.limitsExceeded')}
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">
              {t('rateLimitSettings.warningText')}
              <strong className="block mt-1">{t('rateLimitSettings.recommended')}: {RECOMMENDED_CONFIG.auth_max_attempts} {t('rateLimitSettings.attempts')} {t('rateLimitSettings.perWord')} {RECOMMENDED_CONFIG.auth_window_minutes} {t('rateLimitSettings.minutes')}</strong>
            </p>
          </div>
        </div>
      )}

      {/* Settings grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Auth Rate Limit */}
        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-[var(--text-tertiary)]" />
            <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
              {t('rateLimitSettings.auth')}
            </label>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)]">
                {t('rateLimitSettings.maxLoginAttempts')}
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={config.auth_max_attempts}
                onChange={(e) => handleChange('auth_max_attempts', e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                {t('rateLimitSettings.recommended')}: {RECOMMENDED_CONFIG.auth_max_attempts}
              </p>
            </div>
            
            <div>
              <label className="text-xs text-[var(--text-secondary)]">
                {t('rateLimitSettings.timeWindow')}
              </label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.auth_window_minutes}
                onChange={(e) => handleChange('auth_window_minutes', e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {/* Global Rate Limit */}
        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-[var(--text-tertiary)]" />
            <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
              {t('rateLimitSettings.globalApiLimit')}
            </label>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)]">
                {t('rateLimitSettings.maxRequests')}
              </label>
              <Input
                type="number"
                min={100}
                max={10000}
                value={config.global_max_requests}
                onChange={(e) => handleChange('global_max_requests', e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                {t('rateLimitSettings.recommended')}: {RECOMMENDED_CONFIG.global_max_requests}
              </p>
            </div>
            
            <div>
              <label className="text-xs text-[var(--text-secondary)]">
                {t('rateLimitSettings.timeWindow')}
              </label>
              <Input
                type="number"
                min={1}
                max={60}
                value={config.global_window_minutes}
                onChange={(e) => handleChange('global_window_minutes', e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="mt-4 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-start gap-2">
        <Info className="h-4 w-4 text-primary-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-primary-600 dark:text-primary-400">
          {t('rateLimitSettings.restartNote')}
        </p>
      </div>

      {/* Save button */}
      <div className="flex justify-end mt-6">
        <Button 
          onClick={handleSave}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          {t('rateLimitSettings.saveSettings')}
        </Button>
      </div>
    </div>
  );
};
