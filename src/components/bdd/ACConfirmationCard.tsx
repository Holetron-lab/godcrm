/**
 * ACConfirmationCard — ADR-156 Phase 5D (Frontend scaffold)
 *
 * Displays a single Acceptance Criterion in `agent_claimed` status, along with
 * the agent's evidence (slug, commit SHA, test run id, note), and lets the
 * spec owner confirm (or waive) the criterion with a 6-digit TOTP code.
 *
 * Backend endpoints (Ralph, ADR-156 Phase 5B):
 *   POST /api/v3/bdd/criteria/:id/confirm   { totp_code }
 *   POST /api/v3/bdd/criteria/:id/waive     { totp_code, reason }
 *
 * Error codes:
 *   401 — wrong TOTP code (show attempts-left from body.attempts_remaining)
 *   429 — locked for 1 hour (rate limit)
 *   412 — not enrolled (needs ACEnrollmentQR first)
 *
 * Recovery mode: single 16-char recovery code field, submitted as
 * { recovery_code } instead of { totp_code }.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, KeyRound, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';

export interface ACCriterion {
  id: number;
  code: string;
  /** ADR-0002 §8 Phase 2 (G7.1) — these may be empty strings on legacy rows
   *  authored before the G/W/T split; in that case `description` carries the
   *  original markdown body and is rendered as the fallback block. */
  given: string;
  when: string;
  then: string;
  /** Legacy free-form markdown body (ADR-0002 §8 G7.1 — soft deprecated). */
  description?: string | null;
  priority?: 'must' | 'should' | 'may' | string;
  status?: string;
  claimed_at?: string | null;
  claimed_by_agent?: string | null;
  claimed_evidence?: {
    commit_sha?: string | null;
    commit_url?: string | null;
    test_run_id?: string | number | null;
    test_run_url?: string | null;
    note?: string | null;
  } | null;
}

export interface ACConfirmationCardProps {
  criterion: ACCriterion;
  onConfirmed: () => void;
}

type SubmitMode = 'confirm' | 'waive';

interface ConfirmErrorPayload {
  attempts_remaining?: number;
  message?: string;
  error?: string;
}

async function postBdd(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: ConfirmErrorPayload | null }> {
  const baseUrl = getBaseUrlSync();
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  });
  let data: ConfirmErrorPayload | null = null;
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = (await res.json()) as ConfirmErrorPayload;
    }
  } catch {
    /* swallow — non-JSON body */
  }
  return { ok: res.ok, status: res.status, data };
}

/** Six separate digit inputs with auto-advance, auto-backspace, paste-6 support. */
function TotpDigits({
  value,
  onChange,
  disabled,
  shake,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  shake?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = useMemo(() => {
    const padded = value.padEnd(6, ' ');
    return Array.from({ length: 6 }, (_, i) => padded[i] === ' ' ? '' : padded[i]);
  }, [value]);

  const setDigit = useCallback(
    (idx: number, d: string) => {
      const arr = digits.slice();
      arr[idx] = d;
      onChange(arr.join('').replace(/\s/g, ''));
    },
    [digits, onChange],
  );

  const handleChange = (idx: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setDigit(idx, '');
      return;
    }
    // If user pasted multiple digits into a single field
    if (raw.length > 1) {
      const pasted = raw.slice(0, 6 - idx);
      const arr = digits.slice();
      for (let i = 0; i < pasted.length; i++) arr[idx + i] = pasted[i];
      onChange(arr.join('').replace(/\s/g, ''));
      const next = Math.min(idx + pasted.length, 5);
      refs.current[next]?.focus();
      return;
    }
    setDigit(idx, raw);
    if (idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
      setDigit(idx - 1, '');
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      refs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < 5) {
      refs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    e.preventDefault();
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, 5);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div
      className={cn(
        'flex gap-2',
        shake && 'animate-[shake_0.4s_ease-in-out]',
      )}
      style={{
        // Inline keyframes via CSS custom property fallback — we rely on Tailwind
        // `animate-[shake_...]` which will no-op if the keyframe is absent.
        // Consumers can define @keyframes shake in a global stylesheet.
      }}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handlePaste}
          className={cn(
            'w-10 h-12 text-center text-lg font-mono rounded-md border',
            'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800',
            'text-gray-900 dark:text-gray-100',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

export function ACConfirmationCard({ criterion, onConfirmed }: ACConfirmationCardProps) {
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [mode, setMode] = useState<SubmitMode>('confirm');
  const [waiveReason, setWaiveReason] = useState('');
  const [showWaive, setShowWaive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(t);
  }, [shake]);

  const evidence = criterion.claimed_evidence || {};

  const submit = useCallback(async () => {
    setErrorMsg(null);
    const body: Record<string, unknown> = {};
    if (useRecovery) {
      if (recoveryCode.trim().length !== 16) {
        setErrorMsg('Recovery code must be 16 characters');
        return;
      }
      body.recovery_code = recoveryCode.trim();
    } else {
      if (code.length !== 6) {
        setErrorMsg('Enter all 6 digits');
        return;
      }
      body.totp_code = code;
    }

    if (mode === 'waive') {
      if (!waiveReason.trim()) {
        setErrorMsg('Waive reason is required');
        return;
      }
      body.reason = waiveReason.trim();
    }

    const path =
      mode === 'confirm'
        ? `/bdd/criteria/${criterion.id}/confirm`
        : `/bdd/criteria/${criterion.id}/waive`;

    setIsSubmitting(true);
    try {
      const { ok, status, data } = await postBdd(path, body);
      if (ok) {
        onConfirmed();
        return;
      }
      if (status === 401) {
        setShake(true);
        const remaining =
          typeof data?.attempts_remaining === 'number' ? data.attempts_remaining : null;
        setAttemptsRemaining(remaining);
        setErrorMsg(
          remaining !== null
            ? `Wrong code. Attempts left: ${remaining}`
            : 'Wrong code.',
        );
      } else if (status === 429) {
        setErrorMsg('Locked for 1 hour');
      } else if (status === 412) {
        setErrorMsg('Not enrolled — scan QR first');
      } else {
        setErrorMsg(data?.message || data?.error || `Request failed (${status})`);
      }
    } catch (err) {
      logger.error('[ACConfirmationCard] submit failed', err);
      setErrorMsg('Network error');
    } finally {
      setIsSubmitting(false);
    }
  }, [code, recoveryCode, useRecovery, mode, waiveReason, criterion.id, onConfirmed]);

  return (
    <div className="mt-3 p-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20">
      {/* Criterion G/W/T */}
      <div className="mb-3">
        <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
          {criterion.code}
          {criterion.priority && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 uppercase text-[10px]">
              {criterion.priority}
            </span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-sm text-gray-800 dark:text-gray-200">
          {/* ADR-0002 §8 Phase 2 (G7.1) — render G/W/T when populated; legacy
              rows (only `description` set) fall back to that single block. */}
          {(criterion.given || criterion.when || criterion.then) ? (
            <>
              {criterion.given && <div><span aria-hidden="true">📍 </span><span className="font-semibold">Given</span> {criterion.given}</div>}
              {criterion.when && <div><span aria-hidden="true">⚡ </span><span className="font-semibold">When</span> {criterion.when}</div>}
              {criterion.then && <div><span aria-hidden="true">✅ </span><span className="font-semibold">Then</span> {criterion.then}</div>}
            </>
          ) : (
            <div className="whitespace-pre-wrap">
              {(criterion as { description?: string | null }).description || criterion.then || '—'}
            </div>
          )}
        </div>
      </div>

      {/* Evidence block */}
      <div className="mb-3 p-3 rounded-md bg-white/60 dark:bg-gray-900/40 border border-amber-200 dark:border-amber-800 text-xs">
        <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Agent claim evidence
        </div>
        <div className="grid gap-1 text-gray-700 dark:text-gray-300">
          {criterion.claimed_by_agent && (
            <div>
              <span className="text-gray-500">agent:</span>{' '}
              <span className="font-mono">{criterion.claimed_by_agent}</span>
            </div>
          )}
          {evidence.commit_sha && (
            <div>
              <span className="text-gray-500">commit:</span>{' '}
              {evidence.commit_url ? (
                <a
                  href={evidence.commit_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  {String(evidence.commit_sha).slice(0, 12)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="font-mono">{String(evidence.commit_sha).slice(0, 12)}</span>
              )}
            </div>
          )}
          {evidence.test_run_id && (
            <div>
              <span className="text-gray-500">test run:</span>{' '}
              {evidence.test_run_url ? (
                <a
                  href={evidence.test_run_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  #{evidence.test_run_id}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="font-mono">#{evidence.test_run_id}</span>
              )}
            </div>
          )}
          {evidence.note && (
            <div>
              <span className="text-gray-500">note:</span>{' '}
              <span className="italic">{evidence.note}</span>
            </div>
          )}
          {criterion.claimed_at && (
            <div>
              <span className="text-gray-500">claimed at:</span>{' '}
              <span>{new Date(criterion.claimed_at).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* TOTP input / Recovery input */}
      <div className="mb-3">
        {useRecovery ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Recovery code (16 chars)
            </label>
            <input
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase().slice(0, 16))}
              disabled={isSubmitting}
              className={cn(
                'w-full px-3 py-2 rounded-md border font-mono tracking-widest',
                'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800',
                'text-gray-900 dark:text-gray-100',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
              )}
              placeholder="XXXXXXXXXXXXXXXX"
              aria-label="Recovery code"
            />
          </div>
        ) : (
          <TotpDigits
            value={code}
            onChange={setCode}
            disabled={isSubmitting}
            shake={shake}
          />
        )}
      </div>

      {/* Waive reason */}
      {showWaive && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Waive reason (required)
          </label>
          <textarea
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            disabled={isSubmitting}
            rows={2}
            className={cn(
              'w-full px-3 py-2 rounded-md border text-sm',
              'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800',
              'text-gray-900 dark:text-gray-100',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
            )}
            placeholder="Why is this criterion being waived?"
          />
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="mb-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
          <XCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
          {attemptsRemaining !== null && attemptsRemaining <= 1 && (
            <span className="ml-2 text-xs opacity-70">(next failure locks for 1h)</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => { setMode('confirm'); setShowWaive(false); submit(); }}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium',
            'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50',
          )}
        >
          {isSubmitting && mode === 'confirm' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          Confirm
        </button>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            if (!showWaive) {
              setShowWaive(true);
              setMode('waive');
            } else {
              setMode('waive');
              submit();
            }
          }}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium',
            'border border-gray-300 dark:border-gray-600',
            'text-gray-700 dark:text-gray-300',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
            'disabled:opacity-50',
          )}
        >
          {showWaive ? 'Submit Waive' : 'Waive'}
        </button>

        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v);
            setErrorMsg(null);
            setCode('');
            setRecoveryCode('');
          }}
          className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          <KeyRound className="w-3.5 h-3.5" />
          {useRecovery ? 'Use Authenticator' : 'Lost Authenticator?'}
        </button>
      </div>
    </div>
  );
}

export default ACConfirmationCard;
