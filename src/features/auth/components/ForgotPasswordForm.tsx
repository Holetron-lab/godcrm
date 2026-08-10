import { FormProvider } from 'react-hook-form';
import { useForgotPasswordForm } from '../hooks/useLogin';
import { Input, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface ForgotPasswordFormProps {
  onSuccess?: () => void;
}

export const ForgotPasswordForm = ({ onSuccess }: ForgotPasswordFormProps) => {
  const { form, onSubmit, isLoading, serverError, success } = useForgotPasswordForm(onSuccess);
  const { t } = useLanguage();

  // Parse error message from JSON if needed
  let displayError = serverError;
  try {
    if (serverError && serverError.startsWith('{')) {
      const errorObj = JSON.parse(serverError);
      displayError = errorObj.error?.message || errorObj.error || t('auth.forgot.serverError');
    }
  } catch {
    // Keep original error if JSON parsing fails
  }

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('auth.forgot.description')}
        </p>
        
        <Input
          label={t('auth.forgot.emailLabel')}
          type="email"
          {...form.register('email')}
          error={form.formState.errors.email?.message}
        />
        
        {displayError && (
          <p className="text-sm text-[var(--color-error)]">{displayError}</p>
        )}
        
        {success && (
          <p className="text-sm text-green-600">
            {t('auth.forgot.successMessage')}
          </p>
        )}
        
        <Button type="submit" loading={isLoading} className="w-full" disabled={success}>
          {t('auth.forgot.submit')}
        </Button>
      </form>
    </FormProvider>
  );
};
