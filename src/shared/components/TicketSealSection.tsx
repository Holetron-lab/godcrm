/**
 * TicketSealSection — ADR-0002 §8 Phase 4 (UI for ticket TOTP-act seal).
 *
 * Renders one of two states inside TicketCardContent (or any ticket panel):
 *   - Sealed: read-only badge "Sealed at <ts> by user #<id>"
 *   - Unsealed: action button "Seal ticket" → opens TOTP modal → POSTs
 *     /api/v3/tickets/:id/seal
 *
 * Pre-conditions enforced server-side (we don't pre-check here):
 *   - all Must criteria verified (Phase 3 completion gate)
 *   - human user with `users.totp_enabled = 1`
 *
 * 401 → wrong TOTP, 409 → must-criteria still pending or already sealed,
 * 412 → user has no TOTP enrolled. Each surfaces as a toast.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldCheck, Loader2, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Modal } from '@/shared/components/ui';
import { ticketsApi, type TicketSealError } from '@/features/tickets/api/ticketsApi';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import { formatDate } from '@/shared/utils/dateFormat';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface TicketSealSectionProps {
  ticketId: number;
  /** When the ticket is already sealed, show the read-only badge. */
  sealedAt?: string | null;
  /** sealed_by stored as string id (relation) — we render "user #N" until
   *  a name lookup is plumbed through the parent. */
  sealedBy?: string | number | null;
  /** Hide the seal button entirely (e.g. when ticket is not in `done` state).
   *  Defaults to false — caller is responsible for the visibility rule. */
  hideButton?: boolean;
  /** Called after a successful seal so the parent can refetch. */
  onSealed?: () => void;
  /** Compact mode used inside the accordion footer. */
  compact?: boolean;
}

/**
 * Map a TicketSealError → user-facing toast. Centralized so both the seal
 * and unseal flows present identical error language for the same code.
 */
function showSealErrorToast(
  err: TicketSealError,
  mode: 'seal' | 'unseal',
  t: (ru: string, en: string) => string,
) {
  const code = err.code || '';
  const status = err.status || 500;
  if (status === 409 && code === 'MUST_CRITERIA_INCOMPLETE') {
    const det = err.details;
    showToast(
      t(
        `Не все Must критерии verified: ${det?.must_verified ?? 0}/${det?.must_total ?? 0}`,
        `Not all Must criteria verified: ${det?.must_verified ?? 0}/${det?.must_total ?? 0}`,
      ),
      'error',
    );
    return;
  }
  if (status === 409 && code === 'TICKET_ALREADY_SEALED') {
    showToast(t('Тикет уже запечатан', 'Ticket already sealed'), 'error');
    return;
  }
  if (status === 409 && code === 'TICKET_NOT_SEALED') {
    showToast(t('Тикет не запечатан — нечего распечатывать', 'Ticket is not sealed — nothing to unseal'), 'error');
    return;
  }
  if (status === 412) {
    showToast(t('TOTP не настроен — включите 2FA в настройках профиля', 'TOTP not set up — enable 2FA in profile settings'), 'error');
    return;
  }
  if (status === 401) {
    showToast(t('Неверный TOTP код', 'Invalid TOTP code'), 'error');
    return;
  }
  if (status === 403) {
    showToast(
      mode === 'seal'
        ? t('Агенты не могут подписывать seal', 'Agents cannot sign a seal')
        : t('Агенты не могут распечатывать seal', 'Agents cannot unseal'),
      'error',
    );
    return;
  }
  showToast(err.message || `HTTP ${status}`, 'error');
}

export function TicketSealSection({
  ticketId,
  sealedAt,
  sealedBy,
  hideButton = false,
  onSealed,
  compact = false,
}: TicketSealSectionProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [unsealOpen, setUnsealOpen] = useState(false);
  const [code, setCode] = useState('');
  const [unsealCode, setUnsealCode] = useState('');
  const [unsealReason, setUnsealReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unsealSubmitting, setUnsealSubmitting] = useState(false);

  // ADR-0002 §8 Phase 4 — invalidate the cache surfaces that show seal state.
  // Both seal and unseal use the same set; centralize so future cache keys
  // get added once.
  const invalidateAfterSeal = () => {
    queryClient.invalidateQueries({ queryKey: ['table-rows', 1708] });
    queryClient.invalidateQueries({ queryKey: ['standalone-ticket-columns'] });
    queryClient.invalidateQueries({ queryKey: ['widget-resolve-tickets'] });
  };

  const handleUnseal = async () => {
    const trimmedCode = unsealCode.trim();
    const trimmedReason = unsealReason.trim();
    if (!trimmedCode) {
      showToast(t('Введите 6-значный код TOTP', 'Enter the 6-digit TOTP code'), 'error');
      return;
    }
    if (!trimmedReason) {
      showToast(t('Укажите причину распечатывания', 'Specify a reason for unsealing'), 'error');
      return;
    }
    setUnsealSubmitting(true);
    try {
      await ticketsApi.unseal(ticketId, trimmedCode, trimmedReason);
      showToast(t('Seal снят, тикет распечатан', 'Seal removed, ticket unsealed'), 'success');
      setUnsealOpen(false);
      setUnsealCode('');
      setUnsealReason('');
      invalidateAfterSeal();
      onSealed?.();
    } catch (err) {
      showSealErrorToast(err as TicketSealError, 'unseal', t);
      logger.warn('[TicketSealSection] unseal failed', {
        ticketId,
        code: (err as TicketSealError).code,
        status: (err as TicketSealError).status,
      });
    } finally {
      setUnsealSubmitting(false);
    }
  };

  // Read-only sealed badge + unseal action
  if (sealedAt) {
    const userLabel = sealedBy != null && sealedBy !== '' ? `user #${sealedBy}` : 'unknown user';
    return (
      <>
        <div className="inline-flex items-center gap-1.5">
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400',
              compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
            )}
            title={`Sealed at ${sealedAt}${sealedBy != null ? ` by ${userLabel}` : ''}`}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span className="font-medium">Sealed</span>
            <span className="opacity-70">{formatDate(sealedAt, 'short')}</span>
            {sealedBy != null && <span className="opacity-70">· {userLabel}</span>}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUnsealOpen(true);
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-400',
              'hover:bg-red-500/20 transition-colors',
              compact ? 'px-2 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
            )}
            title={t('Unseal — обратное TOTP-подписанное действие, требует причину', 'Unseal — TOTP-signed reverse act, requires reason')}
          >
            <LockOpen className="w-3 h-3 shrink-0" />
            <span>Unseal</span>
          </button>
        </div>
        <Modal
          open={unsealOpen}
          onOpenChange={(nextOpen) => {
            if (unsealSubmitting) return;
            setUnsealOpen(nextOpen);
            if (!nextOpen) {
              setUnsealCode('');
              setUnsealReason('');
            }
          }}
          title={t('Распечатать тикет', 'Unseal ticket')}
          description={t("Распечатать тикет — обратное действие к seal. Запишется audit-строка action='broken'.", "Unseal the ticket — the reverse of seal. An audit row action='broken' will be recorded.")}
          size="sm"
          primaryAction={{
            label: unsealSubmitting ? t('Распечатывание…', 'Unsealing…') : t('Распечатать', 'Unseal'),
            variant: 'primary',
            onClick: handleUnseal,
            disabled:
              unsealSubmitting ||
              unsealCode.trim().length === 0 ||
              unsealReason.trim().length === 0,
          }}
          secondaryAction={{
            label: t('Отмена', 'Cancel'),
            variant: 'secondary',
            onClick: () => {
              if (unsealSubmitting) return;
              setUnsealOpen(false);
              setUnsealCode('');
              setUnsealReason('');
            },
          }}
        >
          <div className="space-y-3 py-2">
            <div className="text-xs text-[var(--text-tertiary)]">
              {t('Тикет', 'Ticket')} #{ticketId}. {t('Причина обязательна — попадёт в audit-row.', 'Reason is required — it will be recorded in the audit row.')}
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={unsealCode}
              onChange={(e) => setUnsealCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className={cn(
                'w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]',
                'text-center text-lg tracking-[0.5em] font-mono',
                'focus:outline-none focus:border-[var(--color-primary-500)]',
              )}
              disabled={unsealSubmitting}
            />
            <textarea
              value={unsealReason}
              onChange={(e) => setUnsealReason(e.target.value)}
              placeholder={t('Причина распечатывания (обязательно)', 'Reason for unsealing (required)')}
              rows={2}
              className={cn(
                'w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]',
                'text-xs text-[var(--text-primary)]',
                'focus:outline-none focus:border-[var(--color-primary-500)]',
              )}
              disabled={unsealSubmitting}
            />
          </div>
        </Modal>
      </>
    );
  }

  if (hideButton) return null;

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      showToast(t('Введите 6-значный код TOTP', 'Enter the 6-digit TOTP code'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await ticketsApi.seal(ticketId, trimmed);
      showToast(t('Тикет запечатан', 'Ticket sealed'), 'success');
      setOpen(false);
      setCode('');
      invalidateAfterSeal();
      onSealed?.();
    } catch (err) {
      showSealErrorToast(err as TicketSealError, 'seal', t);
      logger.warn('[TicketSealSection] seal failed', {
        ticketId,
        code: (err as TicketSealError).code,
        status: (err as TicketSealError).status,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400',
          'hover:bg-amber-500/20 transition-colors',
          compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        )}
        title={t('Запечатать тикет — TOTP-подписанное действие завершения', 'Seal ticket — TOTP-signed completion act')}
      >
        <Lock className="w-3 h-3 shrink-0" />
        <span className="font-medium">{t('Запечатать тикет', 'Seal ticket')}</span>
      </button>

      <Modal
        open={open}
        onOpenChange={(nextOpen) => {
          if (submitting) return;
          setOpen(nextOpen);
          if (!nextOpen) setCode('');
        }}
        title={t('Запечатать тикет', 'Seal ticket')}
        description={t('Подтвердите запечатывание 6-значным кодом из приложения 2FA.', 'Confirm sealing with the 6-digit code from your 2FA app.')}
        size="sm"
        primaryAction={{
          label: submitting ? t('Запечатывание…', 'Sealing…') : t('Запечатать', 'Seal'),
          variant: 'primary',
          onClick: handleSubmit,
          disabled: submitting || code.trim().length === 0,
        }}
        secondaryAction={{
          label: t('Отмена', 'Cancel'),
          variant: 'secondary',
          onClick: () => {
            if (submitting) return;
            setOpen(false);
            setCode('');
          },
        }}
      >
        <div className="space-y-3 py-2">
          <div className="text-xs text-[var(--text-tertiary)]">
            {t('Тикет', 'Ticket')} #{ticketId}. {t('Все Must-критерии должны быть verified — иначе сервер откажет.', 'All Must criteria must be verified — otherwise the server will reject.')}
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim().length === 6 && !submitting) {
                  handleSubmit();
                }
              }}
              placeholder="000000"
              className={cn(
                'w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]',
                'text-center text-lg tracking-[0.5em] font-mono',
                'focus:outline-none focus:border-[var(--color-primary-500)]',
              )}
              disabled={submitting}
            />
            {submitting && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
            )}
            {!submitting && code.length > 0 && (
              <button
                type="button"
                onClick={() => setCode('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                aria-label={t('Очистить', 'Clear')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

export default TicketSealSection;
