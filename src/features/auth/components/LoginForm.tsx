import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { FormProvider } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useLoginForm } from '../hooks/useLogin';
import { Input, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '../store/authStore';
import type { AuthUser } from '../types/auth.types';
import { isDesktopApp } from '@/shared/types/electron.types';
import { Server, CheckCircle, XCircle, Loader2, Settings } from 'lucide-react';

interface LoginFormProps {
  onForgotPassword?: () => void;
}

export const LoginForm = ({ onForgotPassword }: LoginFormProps) => {
  const { form, onSubmit, isLoading, serverError } = useLoginForm();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [oauthRedirectUri, setOauthRedirectUri] = useState<string | null>(null);
  const setAuth = useAuthStore((state) => state.setAuth);

  // Desktop app server status
  const [serverUrl, setServerUrl] = useState('');
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');

  // Load server URL and check connection on mount (desktop only)
  useEffect(() => {
    if (isDesktopApp() && window.electronAPI) {
      window.electronAPI.getApiUrl().then((url) => {
        setServerUrl(url);
        checkServerConnection(url);
      });
    }
  }, []);

  const checkServerConnection = async (url: string) => {
    if (!window.electronAPI) return;
    setServerStatus('checking');
    
    const result = await window.electronAPI.testApiConnection(url);
    setServerStatus(result.success ? 'success' : 'error');
  };

  const openDesktopSettings = () => {
    // Trigger settings modal via context menu API
    window.electronAPI?.showContextMenu();
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      // In desktop app, use loopback flow (like VS Code)
      // Electron handles OAuth and returns Google access_token directly
      if (window.electronAPI?.openGoogleOAuth) {
        // Open system browser, Electron exchanges code for Google access_token
        const result = await window.electronAPI.openGoogleOAuth();
        
        if (result.success && result.accessToken) {
          // Send Google access_token to backend for JWT creation
          const tokenData = await apiClient.post<{
            success: boolean;
            data?: {
              user: { id: number | string; email: string; name: string; role: string };
              accessToken: string;
            };
            error?: { message: string };
          }>('/auth/google/token', {
            access_token: result.accessToken
          }, { skipAuth: true });

          if (tokenData.success && tokenData.data) {
            const { user, accessToken } = tokenData.data;
            setAuth(accessToken, { ...user, id: String(user.id) } as AuthUser);
            setGoogleLoading(false);
            // Navigate to spaces page after successful login
            navigate('/spaces', { replace: true });
            return;
          } else {
            setGoogleError(tokenData.error?.message || 'Ошибка авторизации');
          }
        } else {
          setGoogleError(result.error || 'Авторизация отменена');
        }
        setGoogleLoading(false);
      } else {
        // Web browser flow
        const data = await apiClient.get<{
          success: boolean;
          data?: { url: string };
          error?: { message: string };
        }>('/auth/google/auth-url', { skipAuth: true });
        
        if (data.success && data.data?.url) {
          window.location.href = data.data.url;
        } else {
          setGoogleError(data.error?.message || 'Google OAuth не настроен');
          setGoogleLoading(false);
        }
      }
    } catch (e) {
      logger.error('Google OAuth error:', e);
      setGoogleError('Ошибка подключения к серверу');
      setGoogleLoading(false);
    }
  };

  // Parse server error to show user-friendly message
  const displayError = serverError 
    ? (serverError.includes('Invalid email or password') 
        ? t('auth.login.invalidCredentials') 
        : t('auth.login.serverError'))
    : null;

  // Check if running in desktop app
  const isDesktop = !!window.electronAPI;

  return (
    <div className="space-y-4">
      {/* Desktop App: Server Status Indicator */}
      {isDesktop && (
        <div 
          className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-3 cursor-pointer hover:bg-[var(--color-background-tertiary)] transition-colors"
          onClick={openDesktopSettings}
          title="Правый клик для открытия настроек"
        >
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-sm text-[var(--color-text-secondary)]">
              {serverUrl.replace(/\/api\/v3$/, '').replace(/^https?:\/\//, '')}
            </span>
            {serverStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-tertiary)]" />}
            {serverStatus === 'success' && <CheckCircle className="w-4 h-4 text-green-500" />}
            {serverStatus === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
          </div>
          <Settings className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        </div>
      )}

      {/* Google Sign-In Button */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={googleLoading}
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-[var(--color-border)] rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {!googleLoading ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="text-[15px] font-medium text-gray-700">
              {t('auth.login.googleSignIn')}
            </span>
          </>
        ) : (
          <span className="text-[15px] font-medium text-gray-700">Loading...</span>
        )}
      </button>
      
      {googleError && <p className="text-sm text-[var(--color-error)]">{googleError}</p>}
      
      {/* Divider */}
      <div className="relative flex justify-center text-sm">
        <span className="px-2 bg-[var(--color-background)] text-[var(--color-text-secondary)]">
          {t('auth.login.orDivider')}
        </span>
      </div>
      
      {/* Regular Login Form */}
      <FormProvider {...form}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Input
            label={t('auth.login.emailLabel')}
            type="email"
            {...form.register('email')}
            error={form.formState.errors.email?.message}
          />
          <Input
            label={t('auth.login.passwordLabel')}
            type="password"
            {...form.register('password')}
            error={form.formState.errors.password?.message}
          />
          
          {/* Forgot password link */}
          {displayError && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-[var(--color-error)]">{displayError}</p>
              <button 
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-[var(--color-primary)] hover:underline whitespace-nowrap"
              >
                {t('auth.login.forgotPassword')}
              </button>
            </div>
          )}
          
          {!displayError && (
            <div className="flex justify-end">
              <button 
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline"
              >
                {t('auth.login.forgotPassword')}
              </button>
            </div>
          )}
          
          <Button type="submit" loading={isLoading} className="w-full">
            {t('auth.login.submit')}
          </Button>
        </form>
      </FormProvider>
    </div>
  );
};
