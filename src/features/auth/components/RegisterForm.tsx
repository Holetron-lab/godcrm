import { useEffect, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate, Link } from 'react-router-dom';
import { useRegisterForm } from '../hooks/useLogin';

const baseInputClass =
  'brutal-edge w-full border-2 bg-[var(--bg-primary)] px-3 py-3 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:bg-[var(--bg-secondary)]';

const labelClass = 'sr-only';
const errorClass = 'mt-1 font-mono text-[11px] uppercase tracking-widest text-red-500';

const looksLikeEmailTaken = (msg: string | null | undefined) =>
  !!msg && /(exist|taken|registered|already|in use)/i.test(msg);

export const RegisterForm = () => {
  const { form, onSubmit, isLoading, serverError, succeeded } = useRegisterForm();
  const [showPassword, setShowPassword] = useState(false);
  const [redirectArmed, setRedirectArmed] = useState(false);

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
      <div className="brutal-edge border-2 p-6 text-center font-mono">
        <p className="text-lg font-black uppercase tracking-tighter text-[var(--text-primary)]">
          door's open.
        </p>
        <p className="mt-2 text-xs uppercase tracking-widest text-[var(--text-secondary)]">
          enter → /workspace
        </p>
      </div>
    );
  }

  const { errors } = form.formState;
  const emailTaken = looksLikeEmailTaken(serverError);

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="reg-name" className={labelClass}>
            name
          </label>
          <input
            id="reg-name"
            type="text"
            autoComplete="name"
            placeholder="what to call you"
            className={baseInputClass}
            aria-invalid={Boolean(errors.name)}
            {...form.register('name')}
          />
          {errors.name?.message && <p className={errorClass}>{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="reg-email" className={labelClass}>
            email
          </label>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@domain.com"
            className={baseInputClass}
            aria-invalid={Boolean(errors.email) || emailTaken}
            {...form.register('email')}
          />
          {errors.email?.message && <p className={errorClass}>{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="reg-password" className={labelClass}>
            password
          </label>
          <div className="brutal-edge flex w-full items-center border-2 bg-[var(--bg-primary)] focus-within:bg-[var(--bg-secondary)]">
            <input
              id="reg-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="password (min 8 chars)"
              className="w-full bg-transparent px-3 py-3 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
              aria-invalid={Boolean(errors.password)}
              {...form.register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="px-3 py-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              aria-label={showPassword ? 'hide password' : 'show password'}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password?.message && <p className={errorClass}>{errors.password.message}</p>}
        </div>

        <div>
          <label htmlFor="reg-promo" className={labelClass}>
            promo code
          </label>
          <input
            id="reg-promo"
            type="text"
            autoComplete="off"
            placeholder="promo code (optional)"
            maxLength={32}
            className={`${baseInputClass} uppercase`}
            aria-invalid={Boolean(errors.promoCode)}
            {...form.register('promoCode', {
              onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                const v = e.target.value.trim().toUpperCase();
                if (v !== e.target.value) form.setValue('promoCode', v, { shouldDirty: true });
              }
            })}
          />
          {errors.promoCode?.message && <p className={errorClass}>{errors.promoCode.message}</p>}
        </div>

        {serverError && (
          <p className="font-mono text-xs uppercase tracking-widest text-red-500">
            {emailTaken ? (
              <>
                this email's already inside. —{' '}
                <Link to="/auth/login" className="underline">
                  sign in?
                </Link>
              </>
            ) : (
              'something broke. try again.'
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="brutal-edge brutal-shadow w-full border-2 px-4 py-3 font-mono text-sm font-black uppercase tracking-widest text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? '[ opening... ]' : '[ open the door ]'}
        </button>
      </form>
    </FormProvider>
  );
};
