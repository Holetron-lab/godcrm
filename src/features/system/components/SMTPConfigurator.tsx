import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input, Button } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { systemApi } from '../api/systemApi';
import type { SMTPConfig } from '../types/system.types';
import { Mail, CheckCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react';

const smtpSchema = z.object({
  host: z.string().min(2, 'SMTP хост обязателен'),
  port: z.coerce.number().min(1).max(65535),
  user: z.string().email('Введите валидный email'),
  password: z.string().min(1, 'Пароль/токен обязателен'),
  from: z.string().email('Введите валидный email отправителя')
});

export const SMTPConfigurator = () => {
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<'unknown' | 'configured' | 'pending'>('unknown');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [verificationCode, setVerificationCode] = useState('');

  // Only owner can configure SMTP
  if (user?.role !== 'owner') {
    return null;
  }

  const form = useForm<SMTPConfig>({
    resolver: zodResolver(smtpSchema),
    defaultValues: { host: '', port: 587, user: '', password: '', from: '' }
  });

  useEffect(() => {
    systemApi
      .fetchSettings()
      .then((response) => {
        const configured = response.data?.smtp_configured === 'true';
        setStatus(configured ? 'configured' : 'pending');
      })
      .catch(() => setStatus('unknown'));
  }, []);

  const handleSubmit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    setAlert(null);
    try {
      await systemApi.saveSmtpSettings(values);
      setAlert({ type: 'success', message: 'Код подтверждения отправлен на ваш email' });
      setStep('verify');
      setStatus('pending');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка сохранения настроек';
      setAlert({ type: 'error', message });
    } finally {
      setIsSubmitting(false);
    }
  });

  const handleVerify = async () => {
    setIsVerifying(true);
    setAlert(null);
    try {
      await systemApi.verifySmtpCode(verificationCode);
      setAlert({ type: 'success', message: 'SMTP настройки успешно подтверждены!' });
      setStatus('configured');
      setStep('form');
      setVerificationCode('');
      form.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неверный код подтверждения';
      setAlert({ type: 'error', message });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Mail className="h-5 w-5 text-primary-500" />
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          Настройка SMTP
        </h3>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            status === 'configured'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : status === 'pending'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }`}
        >
          {status === 'configured' ? (
            <>
              <CheckCircle className="h-3.5 w-3.5" />
              Настроено
            </>
          ) : (
            <>
              <Clock className="h-3.5 w-3.5" />
              Требуется подтверждение
            </>
          )}
        </span>
      </div>
      
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        Настройте SMTP-сервер для отправки email-уведомлений, приглашений и восстановления пароля.
      </p>

      {alert && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm mb-4 ${
            alert.type === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {alert.type === 'success' ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          )}
          {alert.message}
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <p className="text-xs text-[var(--text-tertiary)]">
          Введите данные SMTP-сервера. После отправки вы получите код подтверждения на свой email.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="SMTP хост"
            placeholder="smtp.gmail.com"
            {...form.register('host')}
            error={form.formState.errors.host?.message}
          />
          <Input
            label="Порт"
            type="number"
            placeholder="587"
            {...form.register('port')}
            error={form.formState.errors.port?.message as string}
          />
          <Input
            label="Логин (email)"
            placeholder="your@email.com"
            {...form.register('user')}
            error={form.formState.errors.user?.message}
          />
          <Input
            label="Email отправителя"
            placeholder="noreply@yourdomain.com"
            {...form.register('from')}
            error={form.formState.errors.from?.message}
          />
          <div className="md:col-span-2">
            <Input
              label="Пароль / App Password"
              type="password"
              placeholder="••••••••"
              {...form.register('password')}
              error={form.formState.errors.password?.message}
            />
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
              💡 Для Gmail используйте App Password (настройки → безопасность → пароли приложений)
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Отправка...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Отправить код подтверждения
              </>
            )}
          </Button>
        </div>
      </form>

      {step === 'verify' && (
        <div className="mt-4 space-y-3 rounded-xl border-2 border-primary-500/30 bg-primary-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-primary-600 dark:text-primary-400">
            <Mail className="h-4 w-4" />
            Подтверждение настроек
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            Код подтверждения отправлен на ваш email. Введите его ниже для завершения настройки.
          </p>
          <Input
            label="Код подтверждения"
            placeholder="123456"
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
          />
          <div className="flex gap-3">
            <Button onClick={handleVerify} disabled={isVerifying || !verificationCode} type="button">
              {isVerifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Проверка...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Подтвердить
                </>
              )}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('form')}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
