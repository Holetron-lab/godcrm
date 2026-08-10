import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import { useTablesStore } from '../../store/tablesStore';

function formatTransitionValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ADR-0011: opens on 409 VERIFICATION_REQUIRED / 403 VERIFICATION_IMMUTABLE
// returned from PUT /tables/:tableId/rows/:rowId. Reads meta off the gate
// state (populated from error.details by useRowMutations).
export const VerificationGateModal = () => {
  const gate = useTablesStore((s) => s.verificationGate);
  const close = useTablesStore((s) => s.closeVerificationGate);
  const queryClient = useQueryClient();

  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!gate) {
      setToken('');
      setSubmitting(false);
      return;
    }
    // Focus the TOTP input on open (only when required, not immutable).
    if (gate.reason === 'required') {
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [gate]);

  if (!gate) return null;

  const isImmutable = gate.reason === 'immutable';

  const handleVerify = async () => {
    if (!token.trim()) {
      showToast('Введите код TOTP', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const accessToken = apiClient.getAccessToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

      const transition = gate.offendingColumn
        ? {
            column: gate.offendingColumn,
            from: gate.offendingPrevValue ?? null,
            to: gate.offendingValue ?? null,
          }
        : null;

      const response = await fetch(
        `/api/v3/tables/${gate.tableId}/rows/${gate.rowId}/columns/${gate.verificationColumnId}/verify`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            methods: [{ method: 'totp', token: token.trim() }],
            ...(transition ? { transition } : {}),
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const msg =
          payload?.error?.message ||
          payload?.message ||
          `Verification failed (${response.status})`;
        logger.error('❌ [VerificationGateModal] verify failed:', payload);
        showToast(msg, 'error');
        return;
      }

      // ADR-0011 §PhaseF — optimistically write the new verification cell into the
      // zustand store so the badge appears immediately without waiting for a refetch.
      // Backend stores row.data keyed by column_name, so we mirror that here and
      // preserve the existing audit_log.
      try {
        const state = useTablesStore.getState();
        const row = state.rows[gate.tableId]?.find(
          (r) => String(r.id) === String(gate.rowId),
        );
        const prevCell =
          row?.data && typeof row.data === 'object'
            ? (row.data as Record<string, unknown>)[gate.verificationColumnName]
            : null;
        const parsed =
          typeof prevCell === 'string'
            ? (() => {
                try { return JSON.parse(prevCell); } catch { return null; }
              })()
            : prevCell;
        const prevAudit =
          parsed && typeof parsed === 'object' && Array.isArray((parsed as { audit_log?: unknown }).audit_log)
            ? ((parsed as { audit_log: unknown[] }).audit_log)
            : [];

        const verifiedAt =
          (payload?.data?.verified_at as string | undefined) ||
          new Date().toISOString();
        const jti = (payload?.data?.jti as string | undefined) ?? null;

        state.updateCell(gate.tableId, gate.rowId, gate.verificationColumnName, {
          verified: true,
          verified_at: verifiedAt,
          verified_by_user_id:
            (parsed && typeof parsed === 'object' && 'verified_by_user_id' in parsed
              ? (parsed as { verified_by_user_id?: number | null }).verified_by_user_id
              : null) ?? null,
          methods_used: [{ method: 'totp', at: verifiedAt }],
          jti,
          audit_log: [
            ...prevAudit,
            {
              at: verifiedAt,
              actor: null,
              event: 'verified',
              reason: null,
              ...(transition ? { transition } : {}),
            },
          ],
        });
      } catch (storeErr) {
        logger.warn('[VerificationGateModal] optimistic store write failed:', storeErr);
      }

      showToast('Верификация пройдена — повторите действие', 'success');
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      close();
    } catch (err) {
      logger.error('❌ [VerificationGateModal] verify threw:', err);
      showToast(err instanceof Error ? err.message : 'Ошибка верификации', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!gate}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="🛡️ Требуется верификация"
      description={gate.message}
      size="sm"
      primaryAction={
        isImmutable
          ? undefined
          : {
              label: submitting ? 'Проверка…' : 'Подтвердить',
              variant: 'primary',
              onClick: handleVerify,
              disabled: submitting || !token.trim(),
            }
      }
      secondaryAction={{
        label: isImmutable ? 'Понятно' : 'Отмена',
        variant: 'secondary',
        onClick: close,
      }}
    >
      <div className="space-y-3 py-2 text-sm text-[var(--text-primary)]">
        <dl className="space-y-1.5">
          <div className="flex gap-2">
            <dt className="text-[var(--text-tertiary)] min-w-[140px]">Колонка-гейт:</dt>
            <dd className="font-medium">{gate.verificationColumnName}</dd>
          </div>
          {gate.offendingColumn && (
            <div className="flex gap-2">
              <dt className="text-[var(--text-tertiary)] min-w-[140px]">Изменяется:</dt>
              <dd className="font-medium">
                {gate.offendingColumn}
                {(gate.offendingPrevValue != null || gate.offendingValue != null) && (
                  <span className="ml-1 text-[var(--text-secondary)]">
                    :{' '}
                    <code>{formatTransitionValue(gate.offendingPrevValue)}</code>
                    {' → '}
                    <code>{formatTransitionValue(gate.offendingValue)}</code>
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>

        {isImmutable ? (
          <p className="text-xs text-[var(--text-secondary)] italic">
            Эта ячейка не может быть записана напрямую — используйте кнопку верификации в ячейке.
          </p>
        ) : (
          <div className="space-y-1.5 pt-2 border-t border-[var(--border-color)]">
            <label
              htmlFor="verification-gate-totp"
              className="text-xs text-[var(--text-secondary)]"
            >
              Код TOTP из приложения-аутентификатора
            </label>
            <input
              id="verification-gate-totp"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\s/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting && token.trim()) {
                  handleVerify();
                }
              }}
              placeholder="123456"
              maxLength={8}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono tracking-widest focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
            />
          </div>
        )}
      </div>
    </Modal>
  );
};
