/**
 * ACEnrollmentQR — ADR-156 Phase 5D (Frontend scaffold)
 *
 * One-time TOTP enrollment for a given Acceptance Criterion owner.
 * Renders a QR code from `provisioning_uri` (otpauth://...) and collects
 * the first 6-digit code to finalize enrollment. On success, displays a
 * one-time recovery code that the user MUST save.
 *
 * Backend endpoint (Ralph, ADR-156 Phase 5B):
 *   POST /api/v3/bdd/criteria/:id/enroll-confirm { totp_code }
 *   → { success: true, recovery_code: "XXXX-XXXX-XXXX-XXXX" }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';

export interface ACEnrollmentQRProps {
  criterion: {
    id: number;
    code: string;
    provisioning_uri?: string | null;
  };
  onEnrolled: () => void;
}

interface EnrollResponse {
  success?: boolean;
  recovery_code?: string;
  message?: string;
  error?: string;
}

export function ACEnrollmentQR({ criterion, onEnrolled }: ACEnrollmentQRProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrReady, setQrReady] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Render QR from provisioning_uri
  useEffect(() => {
    const uri = criterion.provisioning_uri;
    if (!uri || !canvasRef.current) {
      setQrReady(false);
      return;
    }
    QRCode.toCanvas(canvasRef.current, uri, { width: 200, margin: 1 }, (err) => {
      if (err) {
        logger.error('[ACEnrollmentQR] QR render failed', err);
        setQrError('Failed to render QR code');
        setQrReady(false);
      } else {
        setQrReady(true);
      }
    });
  }, [criterion.provisioning_uri]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
  };

  const submit = useCallback(async () => {
    setErrorMsg(null);
    if (code.length !== 6) {
      setErrorMsg('Enter all 6 digits');
      return;
    }
    const baseUrl = getBaseUrlSync();
    const token = getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${baseUrl}/bdd/criteria/${criterion.id}/enroll-confirm`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ totp_code: code }),
      });
      let data: EnrollResponse | null = null;
      try {
        if ((res.headers.get('content-type') || '').includes('application/json')) {
          data = (await res.json()) as EnrollResponse;
        }
      } catch {
        /* ignore */
      }
      if (res.ok && data?.recovery_code) {
        setRecoveryCode(data.recovery_code);
      } else if (res.ok) {
        // Backend may not return recovery code — still treat as success
        onEnrolled();
      } else {
        setErrorMsg(data?.message || data?.error || `Enrollment failed (${res.status})`);
      }
    } catch (err) {
      logger.error('[ACEnrollmentQR] submit failed', err);
      setErrorMsg('Network error');
    } finally {
      setIsSubmitting(false);
    }
  }, [code, criterion.id, onEnrolled]);

  const copyRecovery = async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('[ACEnrollmentQR] clipboard write failed', err);
    }
  };

  if (recoveryCode) {
    return (
      <div className="mt-3 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50/60 dark:bg-green-900/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
          <span className="font-semibold text-green-800 dark:text-green-200">
            Enrollment complete
          </span>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
          Save this recovery code somewhere safe. It will <strong>not</strong> be shown again.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 px-3 py-2 rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 font-mono text-sm break-all">
            {recoveryCode}
          </code>
          <button
            type="button"
            onClick={copyRecovery}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium',
              'bg-blue-600 text-white hover:bg-blue-700',
            )}
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <button
          type="button"
          onClick={onEnrolled}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700"
        >
          I've saved it — continue
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20">
      <div className="text-xs font-mono text-gray-500 dark:text-gray-400 mb-2">
        {criterion.code} — Enroll Authenticator
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
        Scan this QR code with your authenticator app (Google Authenticator, 1Password, etc.).
      </p>

      <div className="flex flex-col items-center mb-4">
        {criterion.provisioning_uri ? (
          <canvas
            ref={canvasRef}
            className={cn(
              'bg-white p-2 rounded-md border border-gray-300 dark:border-gray-600',
              !qrReady && 'opacity-40',
            )}
            aria-label="TOTP provisioning QR code"
          />
        ) : (
          <div className="w-[200px] h-[200px] flex items-center justify-center rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-white/50 dark:bg-gray-800/50 text-xs text-gray-500">
            No provisioning URI
          </div>
        )}
        {qrError && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">{qrError}</div>
        )}
      </div>

      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        After scanning, enter current 6-digit code
      </label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={code}
        onChange={handleCodeChange}
        disabled={isSubmitting}
        maxLength={6}
        className={cn(
          'w-full px-3 py-2 mb-3 rounded-md border font-mono tracking-widest text-center text-lg',
          'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800',
          'text-gray-900 dark:text-gray-100',
          'focus:outline-none focus:ring-2 focus:ring-blue-500',
        )}
        placeholder="000000"
        aria-label="TOTP code"
      />

      {errorMsg && (
        <div className="mb-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
          <XCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
        </div>
      )}

      <button
        type="button"
        disabled={isSubmitting || code.length !== 6}
        onClick={submit}
        className={cn(
          'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium',
          'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
        )}
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
        Verify &amp; Enroll
      </button>
    </div>
  );
}

export default ACEnrollmentQR;
