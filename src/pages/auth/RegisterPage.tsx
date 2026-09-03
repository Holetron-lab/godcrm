import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { AuthSocialLinks } from '@/features/auth/components/AuthSocialLinks';
import { LanguageSwitcher } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { TorusBrand } from '@/components/brand/TorusBrand';

const RegisterPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, initialized } = useAuthStore((state) => ({
    user: state.user,
    initialized: state.initialized
  }));

  useEffect(() => {
    if (!initialized || !user) return;
    const redirectState = location.state as { from?: string } | null;
    const target =
      redirectState?.from && typeof redirectState.from === 'string' ? redirectState.from : '/spaces';
    navigate(target, { replace: true });
  }, [initialized, user, navigate, location.state]);

  return (
    <section className="grid min-h-screen grid-cols-1 bg-[var(--bg-primary)] text-[var(--text-primary)] md:grid-cols-2">
      {/* Left panel - hidden on mobile, shown on desktop */}
      <div className="relative hidden items-center justify-center overflow-hidden bg-[var(--bg-secondary)] p-10 md:flex">
        <div style={{ marginTop: '-200px' }} className="flex flex-col items-center">
          <TorusBrand size="hero" interactive />
          <div className="max-w-xl text-center">
            <p className="text-base leading-relaxed text-[var(--text-secondary)]">
              {t('auth.login.heroDescription')}
            </p>
          </div>
          <AuthSocialLinks className="mt-6" />
        </div>
      </div>

      {/* Right panel - register form */}
      <div className="flex min-h-screen flex-col p-6 md:min-h-0 md:justify-center md:p-12">
        {/* Mobile header - shown only on mobile */}
        <div className="mb-8 flex flex-col items-center md:hidden">
          <div className="relative mb-4">
            <span
              className="text-4xl font-bold tracking-[0.25em] text-[var(--text-primary)]"
              style={{
                textShadow:
                  '0 0 24px rgba(96, 165, 250, 0.7), 0 0 48px rgba(147, 197, 253, 0.5), 0 0 80px rgba(59, 130, 246, 0.4)',
              }}
            >
              GOD CRM
            </span>
          </div>
          <span className="text-center text-sm font-semibold uppercase tracking-[0.1em] text-[var(--text-primary)]">
            Generative Orchestration &amp; Development
          </span>
          <span className="text-xs font-medium tracking-wide text-[var(--text-secondary)]">
            Critical Resource Manager
          </span>
        </div>

        {/* Register form card */}
        <div className="mx-auto w-full max-w-md space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t('common.language')}</span>
            <LanguageSwitcher />
          </div>
          <header className="space-y-1">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{t('auth.register.title')}</h2>
          </header>

          <RegisterForm />

          <p className="text-center text-sm text-[var(--text-secondary)]">
            {t('auth.register.haveAccount')}{' '}
            <Link
              to="/auth/login"
              className="font-medium text-[var(--text-secondary)] underline hover:text-[var(--color-primary)]"
            >
              {t('auth.register.signIn')}
            </Link>
          </p>
        </div>

        {/* Mobile social links - shown only on mobile */}
        <AuthSocialLinks className="mt-8 md:hidden" />
      </div>
    </section>
  );
};

export default RegisterPage;
