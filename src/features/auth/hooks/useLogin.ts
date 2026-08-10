import { useCallback, useState } from 'react';
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

export const useRegisterForm = () => {
  const { register: registerAction, loading, error } = useAuthStore();
  const [succeeded, setSucceeded] = useState(false);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', name: '', promoCode: '' }
  });

  const handleSubmit = useCallback(
    async (values: RegisterFormValues) => {
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
        user_agent: ua
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
    succeeded
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
