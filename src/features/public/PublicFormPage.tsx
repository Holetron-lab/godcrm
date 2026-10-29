/**
 * PublicFormPage — the published table form behind the FormBuilder link
 * (`/forms/:tableId`, `/forms/:tableId/embed`). Chat 3660.
 *
 * Renders the 'custom' form config with the same DynamicFormRenderer the
 * add-row modal uses. Access is decided server-side on the space-visibility
 * scale (internal → table member, open → any signed-in user, external →
 * anyone); URL prefill applies only to fields flagged `urlParam` in the builder.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, LogIn } from 'lucide-react';

import { publicApi, PublicApiError, type PublicFormColumn } from './publicApi';
import { buildInitialFormData, buildUrlPrefill } from './publicFormPrefill';
import { usePublicSeo } from './usePublicSeo';
import { DynamicFormRenderer } from '@/features/tables/components/FormBuilder/DynamicFormRenderer';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { FormField } from '@/features/tables/types/form-config.types';
import { useAuthStore } from '@/features/auth/store/authStore';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const toColumnModel = (c: PublicFormColumn): ColumnModel => ({
  id: String(c.id),
  tableId: String(c.table_id),
  name: c.column_name,
  displayName: c.display_name,
  type: c.type as ColumnModel['type'],
  config: c.config as ColumnModel['config'],
  isRequired: c.is_required,
  isReadonly: c.is_readonly,
  orderIndex: c.order_index,
  width: 160,
  isVisible: true,
});

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function PublicFormPage({ embed = false }: { embed?: boolean }) {
  const { tableId } = useParams<{ tableId: string }>();
  const numericId = Number(tableId);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { t } = useLanguage();
  // Wait for the auth bootstrap so a signed-in user opens an internal/open
  // form with their token instead of bouncing off a 401 first.
  const authReady = useAuthStore((s) => s.initialized);

  const formQuery = useQuery({
    queryKey: ['publicForm', numericId],
    queryFn: () => publicApi.getForm(numericId).then((r) => r.data),
    enabled: authReady && Number.isInteger(numericId) && numericId > 0,
    retry: false,
  });
  const form = formQuery.data;

  usePublicSeo({ title: form ? form.table.name : 'Form' });

  const columns = useMemo(() => (form?.columns ?? []).map(toColumnModel), [form]);
  const fields = useMemo<FormField[]>(() => form?.config.fields ?? [], [form]);
  const prefill = useMemo(() => buildUrlPrefill(fields, columns, searchParams), [fields, columns, searchParams]);
  const prefilledColumnIds = useMemo(() => new Set(Object.keys(prefill)), [prefill]);

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (form) setFormData(buildInitialFormData(fields, columns, prefill));
  }, [form, fields, columns, prefill]);

  const handleSubmit = async () => {
    if (!form) return;
    const missing = fields.some((f) => {
      if (f.readonly || (f.hidden && !prefilledColumnIds.has(f.columnId))) return false;
      const column = columns.find((c) => c.id === f.columnId);
      return !!column && (f.required || column.isRequired) && isEmpty(formData[column.id]);
    });
    if (missing) { setSubmitError(t('publicForm.required')); return; }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicApi.submitForm(numericId, formData);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('publicForm.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setSubmitted(false);
    setSubmitError(null);
    setFormData(buildInitialFormData(fields, columns, prefill));
  };

  const renderBody = () => {
    if (!authReady || formQuery.isLoading) {
      return (
        <div className="flex items-center justify-center gap-2 py-12 text-[var(--text-tertiary)]">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{t('publicForm.loading')}</span>
        </div>
      );
    }

    if (formQuery.error || !form) {
      const status = formQuery.error instanceof PublicApiError ? formQuery.error.status : 0;
      const key = status === 401 ? 'authRequired' : status === 403 ? 'forbidden' : status === 404 ? 'notFound' : 'error';
      // Same contract as Layout's auth guard: LoginPage reads `state.from`
      // through resolvePostLoginTarget and sends the member back here.
      const returnTo = `${location.pathname}${location.search}`;
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="w-8 h-8 text-[var(--text-tertiary)]" aria-hidden="true" />
          <p className="text-base font-medium text-[var(--text-primary)]">{t(`publicForm.${key}`)}</p>
          {(key === 'authRequired' || key === 'forbidden' || key === 'notFound') && (
            <p className="text-sm text-[var(--text-tertiary)] max-w-md">{t(`publicForm.${key}Hint`)}</p>
          )}
          {status === 401 && (
            <Link
              to="/auth/login"
              state={{ from: returnTo }}
              className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium hover:opacity-90"
            >
              <LogIn className="w-4 h-4" aria-hidden="true" />
              {t('publicForm.signIn')}
            </Link>
          )}
        </div>
      );
    }

    if (submitted) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center" role="status">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" aria-hidden="true" />
          <p className="text-base font-medium text-[var(--text-primary)]">{t('publicForm.success')}</p>
          <Button variant="secondary" size="sm" onClick={reset}>{t('publicForm.submitAnother')}</Button>
        </div>
      );
    }

    return (
      <form
        onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        className="flex flex-col gap-4"
        noValidate
      >
        <DynamicFormRenderer
          config={form.config}
          columns={columns}
          formData={formData}
          onChange={(id, value) => setFormData((prev) => ({ ...prev, [id]: value }))}
          mode="add"
          prefilledColumnIds={prefilledColumnIds}
        />
        {submitError && (
          <p role="alert" className="text-sm text-red-500">{submitError}</p>
        )}
        <div className="flex justify-end pt-2 border-t border-[var(--border-primary)]">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('publicForm.submitting') : (form.config.settings?.submitButtonText || t('publicForm.submit'))}
          </Button>
        </div>
      </form>
    );
  };

  const card = (
    <div className={embed ? '' : 'w-full max-w-2xl rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-sm p-6'}>
      {form && !submitted && (
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          {form.table.icon && <span aria-hidden="true">{form.table.icon}</span>}
          {form.table.name}
        </h1>
      )}
      {renderBody()}
    </div>
  );

  if (embed) return <div className="p-4">{card}</div>;

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] flex flex-col items-center px-4 py-10">
      {card}
      <p className="mt-6 text-xs text-[var(--text-tertiary)]">{t('publicForm.poweredBy')}</p>
    </div>
  );
}

export default PublicFormPage;
