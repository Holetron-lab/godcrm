import { useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordFormValues, LoginFormValues, RegisterFormValues, loginSchema, registerSchema, forgotPasswordSchema } from '../types/auth.types';
import { useAuthStore } from '../store/authStore';

export const useLoginForm = () => {
  const { login, loading, error } = useAuthStore();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  });

  const handleSubmit = useCallback(
    async (values: LoginFormValues) => {
      await login(values);
    },
    [login]
  );

  return { form, onSubmit: form.handleSubmit(handleSubmit), isLoading: loading, serverError: error };
};

// ADR-183-A — read the inviter's referral code from the `?ref=<code>` deep-link
// (https://<host>/auth/register?ref=<code>). Codes are lowercase (`slug-suffix`),
// so we normalize the URL value to lowercase before it seeds the visible field.
const readInviteRefFromUrl = (): string => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('ref')?.trim().toLowerCase() || '';
};

export const useRegisterForm = () => {
  const { register: registerAction, loading, error } = useAuthStore();
  const [succeeded, setSucceeded] = useState(false);
  // Snapshot the deep-link code once so re-renders don't clobber user edits.
  const initialReferral = useMemo(readInviteRefFromUrl, []);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', name: '', referralCode: initialReferral, promoCode: '' }
  });

  const handleSubmit = useCallback(
    async (values: RegisterFormValues) => {
      // Referral: lowercase (named-code format); Promo: uppercase (campaign codes).
      const referralNormalized = values.referralCode?.trim().toLowerCase() || null;
      const promoNormalized = values.promoCode?.trim().toUpperCase() || null;
      const referrer = typeof document !== 'undefined' ? document.referrer || null : null;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      await registerAction({
        name: values.name,
        email: values.email,
        password: values.password,
        promo_code: promoNormalized,
        signup_source: 'godcrm.ai/register',
        signup_referrer: referrer,
        user_agent: ua,
        // Best-effort: server resolves unknown/absent codes to referred_by=NULL.
        referral_code: referralNormalized
      });
      setSucceeded(true);
    },
    [registerAction]
  );

  return {
    form,
    onSubmit: form.handleSubmit(handleSubmit),
    isLoading: loading,
    serverError: error,
    succeeded,
    /** True when the referral field was seeded from a `?ref=` invite link. */
    referralPrefilled: Boolean(initialReferral)
  };
};

export const useForgotPasswordForm = (onSuccess?: () => void) => {
  const { requestReset, loading, error } = useAuthStore();
  const [success, setSuccess] = useState(false);
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' }
  });

  const handleSubmit = useCallback(
    async (values: ForgotPasswordFormValues) => {
      setSuccess(false);
      const result = await requestReset(values);
      if (result) {
        setSuccess(true);
        if (onSuccess) {
          setTimeout(() => {
            onSuccess();
          }, 3000);
        }
      }
    },
    [requestReset, onSuccess]
  );

  return { form, onSubmit: form.handleSubmit(handleSubmit), isLoading: loading, serverError: error, success };
};
