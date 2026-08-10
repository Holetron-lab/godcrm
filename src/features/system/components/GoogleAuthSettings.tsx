import { useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input, Button } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { Chrome, CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink } from 'lucide-react';

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  enabled: boolean;
}

interface GoogleOAuthStatus {
  clientId: string;
  redirectUri: string;
  enabled: boolean;
  hasSecret: boolean;
}

const googleAuthSchema = z.object({
  clientId: z.string().min(10, 'Client ID обязателен'),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url('Введите валидный URL'),
  enabled: z.boolean()
});

export const GoogleAuthSettings = () => {
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<GoogleOAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Only owner can configure Google Auth
  if (user?.role !== 'owner') {
    return null;
  }

  const form = useForm<GoogleOAuthConfig>({
    resolver: zodResolver(googleAuthSchema),
    defaultValues: {
      clientId: '',
      clientSecret: '',
      redirectUri: 'https://crm.hltrn.cc/auth/google/callback',
      enabled: false
    }
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await apiClient.request<{ success: boolean; data: GoogleOAuthStatus }>('/auth/google/config');
      if (response.success && response.data) {
        setStatus(response.data);
        form.reset({
          clientId: response.data.clientId || '',
          clientSecret: '',
          redirectUri: response.data.redirectUri || 'https://crm.hltrn.cc/auth/google/callback',
          enabled: response.data.enabled || false
        });
      }
    } catch (error) {
      logger.error('Failed to load Google OAuth config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    setAlert(null);
    try {
      const payload: Partial<GoogleOAuthConfig> = {
        clientId: values.clientId,
        redirectUri: values.redirectUri,
        enabled: values.enabled
      };
      
      // Only send secret if it was changed
      if (values.clientSecret) {
        payload.clientSecret = values.clientSecret;
      }

      await apiClient.request<{ success: boolean }>('/auth/google/config', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      setAlert({ type: 'success', message: 'Настройки Google OAuth сохранены' });
      await loadConfig();
      form.setValue('clientSecret', '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка сохранения';
      setAlert({ type: 'error', message });
    } finally {
      setSaving(false);
    }
  });

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Chrome className="h-5 w-5 text-primary-500" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Google OAuth
          </h3>
        </div>
        <label className="relative inline-flex cursor-pointer items-center gap-3">
          <span className="text-sm text-[var(--text-secondary)]">
            {form.watch('enabled') ? 'Включено' : 'Отключено'}
          </span>
          <input
            type="checkbox"
            className="peer sr-only"
            {...form.register('enabled')}
          />
          <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:right-[22px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:bg-gray-700"></div>
        </label>
      </div>

      {alert && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm mb-4 ${
            alert.type === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {alert.type === 'success' ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          )}
          {alert.message}
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <p className="text-xs text-[var(--text-tertiary)]">
          Настройте вход через Google. Получите Client ID и Secret в{' '}
          <a 
            href="https://console.cloud.google.com/apis/credentials" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary-500 hover:underline inline-flex items-center gap-1"
          >
            Google Cloud Console
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Client ID"
              placeholder="123456789-abc.apps.googleusercontent.com"
              {...form.register('clientId')}
              error={form.formState.errors.clientId?.message}
            />
          </div>
          
          <div className="md:col-span-2">
            <div className="relative">
              <Input
                label={status?.hasSecret ? 'Client Secret (оставьте пустым, чтобы сохранить текущий)' : 'Client Secret'}
                type={showSecret ? 'text' : 'password'}
                placeholder={status?.hasSecret ? '••••••••' : 'GOCSPX-...'}
                {...form.register('clientSecret')}
                error={form.formState.errors.clientSecret?.message}
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-8 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="md:col-span-2">
            <Input
              label="Redirect URI"
              placeholder="https://crm.hltrn.cc/auth/google/callback"
              {...form.register('redirectUri')}
              error={form.formState.errors.redirectUri?.message}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Сохранение...
              </>
            ) : (
              <>
                <Chrome className="h-4 w-4 mr-2" />
                Сохранить настройки
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};
