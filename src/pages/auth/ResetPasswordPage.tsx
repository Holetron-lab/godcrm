import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Button, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const ResetPasswordPage = () => {
  logger.debug('[ResetPasswordPage] Component mounted');
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  logger.debug('[ResetPasswordPage] Token:', token);

  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setIsValidating(false);
      setError(t('auth.reset.invalidToken'));
      return;
    }

    const validateToken = async () => {
      try {
        const response = await fetch(`/api/v3/auth/verify-reset-token/${token}`);
        const data = await response.json();
        
        if (data.success && data.data?.valid) {
          setIsValid(true);
          setEmail(data.data.email);
        } else {
          setError(data.error?.message || t('auth.reset.invalidToken'));
        }
      } catch {
        setError(t('auth.reset.serverError'));
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords
    if (password.length < 8) {
      setError(t('auth.reset.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.reset.passwordsMismatch'));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/v3/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/auth/login');
        }, 3000);
      } else {
        setError(data.error?.message || t('auth.reset.serverError'));
      }
    } catch {
      setError(t('auth.reset.serverError'));
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isValidating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)] mx-auto mb-4"></div>
          <p className="text-sm text-[var(--text-secondary)]">{t('auth.reset.validating')}</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (!isValid && !success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('auth.reset.invalidTokenTitle')}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{error || t('auth.reset.invalidToken')}</p>
          <Link 
            to="/auth/login" 
            className="inline-block mt-4 text-[var(--color-primary)] hover:underline"
          >
            {t('auth.reset.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('auth.reset.successTitle')}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{t('auth.reset.successMessage')}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{t('auth.reset.redirecting')}</p>
        </div>
      </div>
    );
  }

  // Reset form
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('auth.reset.title')}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('auth.reset.subtitle')} <span className="font-medium">{email}</span>
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('auth.reset.newPassword')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.reset.newPasswordPlaceholder')}
            required
          />

          <Input
            label={t('auth.reset.confirmPassword')}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('auth.reset.confirmPasswordPlaceholder')}
            required
          />

          {error && (
            <p className="text-sm text-[var(--color-error)]">{error}</p>
          )}

          <Button type="submit" loading={isLoading} className="w-full">
            {t('auth.reset.submit')}
          </Button>
        </form>

        <div className="text-center">
          <Link 
            to="/auth/login" 
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] hover:underline"
          >
            {t('auth.reset.backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
