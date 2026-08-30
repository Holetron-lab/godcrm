import { useEffect, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate, Link } from 'react-router-dom';
import { useRegisterForm } from '../hooks/useLogin';
import { authApi } from '../api/authApi';
import { Input, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const looksLikeEmailTaken = (msg: string | null | undefined) =>
  !!msg && /(exist|taken|registered|already|in use)/i.test(msg);

export const RegisterForm = () => {
  const { t } = useLanguage();
  const { form, onSubmit, isLoading, serverError, succeeded, referralPrefilled } = useRegisterForm();
  const [showPassword, setShowPassword] = useState(false);
  const [redirectArmed, setRedirectArmed] = useState(false);

  // ADR-183-A D6 — the promo field is shown only when the owner-controlled
  // `promo_enabled` flag is on. Public, pre-auth; default hidden until known.
  const { data: regConfig } = useQuery({
    queryKey: ['registration-config'],
    queryFn: async () => {
      const res = await authApi.getRegistrationConfig();
      return res.success ? res.data : null;
    },
    staleTime: 5 * 60 * 1000
  });
  const promoEnabled = regConfig?.promo_enabled === true;

  useEffect(() => {
    if (!succeeded) return;
    const id = window.setTimeout(() => setRedirectArmed(true), 1500);
    return () => window.clearTimeout(id);
  }, [succeeded]);

  if (redirectArmed) {
    return <Navigate to="/spaces" replace />;
  }

  if (succeeded) {
    return (
      <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 text-center">
        <p className="text-lg font-semibold text-[var(--text-primary)]">
          {t('auth.register.successTitle')}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t('auth.register.successSubtitle')}
        </p>
      </div>
    );
  }

  const { errors } = form.formState;
  const emailTaken = looksLikeEmailTaken(serverError);

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          label={t('auth.register.nameLabel')}
          type="text"
          autoComplete="name"
          placeholder={t('auth.register.namePlaceholder')}
          error={errors.name?.message}
          {...form.register('name')}
        />

        <Input
          label={t('auth.register.emailLabel')}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t('auth.register.emailPlaceholder')}
          error={errors.email?.message}
          {...form.register('email')}
        />

        <Input
          label={t('auth.register.passwordLabel')}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={t('auth.register.passwordPlaceholder')}
          error={errors.password?.message}
          rightAddon={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="flex items-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              aria-label={showPassword ? t('auth.register.hidePassword') : t('auth.register.showPassword')}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
          {...form.register('password')}
        />

        {/* ADR-183-A — referral field: always visible, prefilled from ?ref=, editable. */}
        <Input
          label={t('auth.register.referralLabel')}
          type="text"
          autoComplete="off"
          placeholder={t('auth.register.referralPlaceholder')}
          maxLength={48}
          hint={referralPrefilled ? t('auth.register.referralHint') : undefined}
          error={errors.referralCode?.message}
          {...form.register('referralCode', {
            onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
              const v = e.target.value.trim().toLowerCase();
              if (v !== e.target.value) form.setValue('referralCode', v, { shouldDirty: true });
            }
          })}
        />

        {/* ADR-183-A D6 — promo field gated on the owner `promo_enabled` flag. */}
        {promoEnabled && (
          <Input
            label={t('auth.register.promoLabel')}
            type="text"
            autoComplete="off"
            placeholder={t('auth.register.promoPlaceholder')}
            maxLength={32}
            className="uppercase"
            error={errors.promoCode?.message}
            {...form.register('promoCode', {
              onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                const v = e.target.value.trim().toUpperCase();
                if (v !== e.target.value) form.setValue('promoCode', v, { shouldDirty: true });
              }
            })}
          />
        )}

        {serverError && (
          <p className="text-sm text-[var(--color-error)]">
            {emailTaken ? (
              <>
                {t('auth.register.emailTaken')}{' '}
                <Link to="/auth/login" className="underline hover:text-[var(--color-primary)]">
                  {t('auth.register.signIn')}
                </Link>
              </>
            ) : (
              t('auth.register.genericError')
            )}
          </p>
        )}

        <Button type="submit" loading={isLoading} className="w-full">
          {isLoading ? t('auth.register.submitting') : t('auth.register.submit')}
        </Button>
      </form>
    </FormProvider>
  );
};
