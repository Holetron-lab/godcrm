import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const ErrorBoundaryPage = () => {
  const error = useRouteError();
  const { t } = useLanguage();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message = isRouteErrorResponse(error)
    ? error.statusText || error.data?.message
    : error instanceof Error
      ? error.message
      : t('error.description');

  return (
    <section className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[var(--text-tertiary)]">Error {status}</p>
      <h1 className="text-3xl font-semibold text-[var(--text-primary)]">{t('error.title')}</h1>
      <p className="max-w-md text-sm text-[var(--text-secondary)]">{message}</p>
      <Link
        to="/dashboard"
        className="rounded-md bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white shadow-sm"
      >
        {t('notFound.goDashboard')}
      </Link>
    </section>
  );
};

export default ErrorBoundaryPage;
