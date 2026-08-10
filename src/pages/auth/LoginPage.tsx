import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';
import { LanguageSwitcher } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { TorusBrand } from '@/components/brand/TorusBrand';

const LoginPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const { user, initialized } = useAuthStore((state) => ({
    user: state.user,
    initialized: state.initialized,
  }));

  useEffect(() => {
    if (!initialized || !user) return;

    const searchParams = new URLSearchParams(location.search);
    const redirectParam = searchParams.get('redirect');

    if (redirectParam) {
      const decodedRedirect = decodeURIComponent(redirectParam);
      window.location.href = decodedRedirect;
      return;
    }

    const redirectState = location.state as { from?: string } | null;
    const target = redirectState?.from && typeof redirectState.from === 'string' ? redirectState.from : '/spaces';
    navigate(target, { replace: true });
  }, [initialized, user, navigate, location.state, location.search]);

  if (!initialized) {
    return <AuthLoader />;
  }

  if (user) {
    return null;
  }

  return (
    <section className="grid min-h-screen grid-cols-1 bg-[var(--bg-primary)] text-[var(--text-primary)] md:grid-cols-2">
      {/* Left panel - hidden on mobile, shown on desktop */}
      <div className="relative hidden md:flex items-center justify-center bg-[var(--bg-secondary)] p-10 overflow-hidden">
        <div style={{ marginTop: '-200px' }} className="flex flex-col items-center">
          <TorusBrand size="hero" interactive />
          {/* Description - below the line */}
          <div className="max-w-xl text-center">
            <p className="text-base text-[var(--text-secondary)] leading-relaxed">
              {t('auth.login.heroDescription')}
            </p>
          </div>
          {/* Social links */}
          <div className="flex items-center gap-6 mt-6">
            <a
              href="https://t.me/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Telegram
            </a>
            <a
              href="https://github.com/holetron"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
            <a
              href="https://x.com/god_crm"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              X
            </a>
          </div>
        </div>
      </div>
      {/* Right panel - login form */}
      <div className="flex flex-col min-h-screen md:min-h-0 md:justify-center p-6 md:p-12">
        {/* Mobile header - shown only on mobile */}
        <div className="flex flex-col items-center mb-8 md:hidden">
          <div className="relative mb-4">
            <span
              className="text-4xl font-bold tracking-[0.25em] text-[var(--text-primary)]"
              style={{
                textShadow: '0 0 24px rgba(96, 165, 250, 0.7), 0 0 48px rgba(147, 197, 253, 0.5), 0 0 80px rgba(59, 130, 246, 0.4)',
              }}
            >
              GOD CRM
            </span>
          </div>
          <span className="text-sm font-semibold tracking-[0.1em] uppercase text-[var(--text-primary)] text-center">
            Generative Orchestration & Development
          </span>
          <span className="text-xs font-medium tracking-wide text-[var(--text-secondary)]">
            Critical Resource Manager
          </span>
        </div>

        {/* Login form */}
        <div className="w-full max-w-md mx-auto space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t('common.language')}</span>
            <LanguageSwitcher />
          </div>
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
              {showForgotPassword ? t('auth.forgot.title') : t('auth.login.title')}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {showForgotPassword ? t('auth.forgot.description') : t('auth.login.subtitle')}
            </p>
          </header>

          {showForgotPassword ? (
            <div className="space-y-4">
              <ForgotPasswordForm onSuccess={() => setShowForgotPassword(false)} />
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline"
              >
                {t('auth.forgot.backToLogin')}
              </button>
            </div>
          ) : (
            <LoginForm onForgotPassword={() => setShowForgotPassword(true)} />
          )}
        </div>

        {/* Mobile social links - shown only on mobile */}
        <div className="flex items-center justify-center gap-6 mt-8 md:hidden">
          <a
            href="https://t.me/god_crm"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            Telegram
          </a>
          <a
            href="https://github.com/holetron"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a
            href="https://x.com/god_crm"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            X
          </a>
        </div>
      </div>
    </section>
  );
};

export default LoginPage;

const AuthLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
    <p className="text-sm text-[var(--text-secondary)]">Loading authentication...</p>
  </div>
);
