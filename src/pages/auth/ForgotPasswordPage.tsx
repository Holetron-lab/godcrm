import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const ForgotPasswordPage = () => {
  const { t } = useLanguage();
  return (
    <section className="mx-auto max-w-md space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-md">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('auth.forgot.title')}</h1>
        <p className="text-sm text-[var(--text-secondary)]">{t('auth.forgot.subtitle')}</p>
      </header>
      <ForgotPasswordForm />
    </section>
  );
};

export default ForgotPasswordPage;
