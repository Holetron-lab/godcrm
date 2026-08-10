import { useEffect, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { Loader2 } from 'lucide-react';

type CallbackMode = 'login' | 'calendar';

export default function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [mode, setMode] = useState<CallbackMode>('login');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(errorParam);
      setStatus('error');
      return;
    }

    if (!code) {
      setError('No authorization code received');
      setStatus('error');
      return;
    }

    // Detect if this is a Google Calendar connection (state starts with "calendar:")
    const isCalendar = state?.startsWith('calendar:');
    if (isCalendar) {
      setMode('calendar');
    }

    if (isCalendar) {
      // Calendar OAuth callback — exchange code for calendar tokens via authenticated API
      const connectCalendar = async () => {
        try {
          const redirectUri = `${window.location.origin}/auth/google/callback`;
          const response = await apiClient.post<{
            success: boolean;
            data?: { connected: boolean; email: string; calendars: Array<{ id: string; summary: string }> };
            error?: { message: string };
          }>('/calendar/callback', { code, redirect_uri: redirectUri });

          if (response.success && response.data) {
            setStatus('success');
            // Redirect to settings or space page after short delay
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 2000);
          } else {
            setError(response.error?.message || 'Calendar connection failed');
            setStatus('error');
          }
        } catch (err: unknown) {
          logger.error('Google Calendar connect error:', err);
          const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
          setError(axiosErr.response?.data?.error?.message || axiosErr.message || 'Calendar connection failed');
          setStatus('error');
        }
      };

      connectCalendar();
    } else {
      // Login OAuth callback — exchange code for auth tokens (no auth needed)
      const exchangeCode = async () => {
        try {
          const response = await apiClient.post<{
            success: boolean;
            data?: {
              user: { id: number; email: string; name: string; role: string };
              accessToken: string;
            };
            error?: { message: string };
          }>('/auth/google/callback', { code }, { skipAuth: true });

          if (response.success && response.data) {
            const { user, accessToken } = response.data;

            // Store auth data
            setAuth(accessToken, user);

            setStatus('success');

            // Redirect to dashboard after short delay
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 1000);
          } else {
            setError(response.error?.message || 'Authentication failed');
            setStatus('error');
          }
        } catch (err: unknown) {
          logger.error('Google OAuth error:', err);
          const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
          setError(axiosErr.response?.data?.error?.message || axiosErr.message || 'Authentication failed');
          setStatus('error');
        }
      };

      exchangeCode();
    }
  }, [searchParams, navigate, setAuth]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--color-primary-500)] mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            {mode === 'calendar' ? 'Подключение Google Calendar...' : 'Вход через Google...'}
          </h1>
          <p className="text-[var(--text-secondary)]">
            Пожалуйста, подождите
          </p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="text-6xl mb-4">✓</div>
          <h1 className="text-xl font-semibold text-green-500 mb-2">
            {mode === 'calendar' ? 'Календарь подключён!' : 'Успешный вход!'}
          </h1>
          <p className="text-[var(--text-secondary)]">
            Перенаправление...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center max-w-md px-4">
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-xl font-semibold text-red-500 mb-2">
          {mode === 'calendar' ? 'Ошибка подключения календаря' : 'Ошибка авторизации'}
        </h1>
        <p className="text-[var(--text-secondary)] mb-6">
          {error}
        </p>
        <button
          onClick={() => navigate(mode === 'calendar' ? '/' : '/auth/login', { replace: true })}
          className="px-6 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] transition"
        >
          {mode === 'calendar' ? 'Вернуться' : 'Вернуться к входу'}
        </button>
      </div>
    </div>
  );
}
