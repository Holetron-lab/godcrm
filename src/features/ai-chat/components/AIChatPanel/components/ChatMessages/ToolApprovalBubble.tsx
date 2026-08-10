/**
 * ToolApprovalBubble.tsx
 * Ticket #74077: Inline tool approval bubble for AI Chat.
 *
 * Shows Allow / Deny / Always Allow buttons when an agent requests
 * to execute a dangerous tool. Displays countdown timer, expandable
 * arguments preview, and result status after a decision is made.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, Check, X, Unlock, ChevronDown, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ToolApprovalBubbleProps {
  toolName: string;
  args: Record<string, unknown>;
  messageId: number;
  conversationId: number;
  approvalStatus: ApprovalStatus;
  timeoutSeconds?: number;
  approvedBy?: string;
  approvedAt?: string;
  onApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  onReject?: (messageId: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTimeAgo(isoString: string): string {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
}

function prettyPrintArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

// ---------------------------------------------------------------------------
// Status-specific styling
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ApprovalStatus, { border: string; bg: string; icon: string }> = {
  pending:  { border: 'border-yellow-500/50', bg: 'bg-yellow-900/20', icon: 'text-yellow-400' },
  approved: { border: 'border-green-500/50',  bg: 'bg-green-900/20',  icon: 'text-green-400' },
  rejected: { border: 'border-red-500/50',    bg: 'bg-red-900/20',    icon: 'text-red-400' },
  timeout:  { border: 'border-gray-500/50',   bg: 'bg-gray-900/20',   icon: 'text-gray-400' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToolApprovalBubble: React.FC<ToolApprovalBubbleProps> = ({
  toolName,
  args,
  messageId,
  conversationId,
  approvalStatus,
  timeoutSeconds = 300,
  approvedBy,
  approvedAt,
  onApprove,
  onReject,
}) => {
  // ── Local state ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState<ApprovalStatus>(approvalStatus);
  const [remaining, setRemaining] = useState<number>(timeoutSeconds);
  const [argsExpanded, setArgsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localApprovedBy, setLocalApprovedBy] = useState(approvedBy);
  const [localApprovedAt, setLocalApprovedAt] = useState(approvedAt);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync status from props (when backend pushes updates)
  useEffect(() => {
    setStatus(approvalStatus);
  }, [approvalStatus]);

  // ── Countdown timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'pending') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setStatus('timeout');
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // ── Auto-scroll into view when pending (user-actionable) ────────────────
  useEffect(() => {
    if (status === 'pending' && bubbleRef.current) {
      bubbleRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [status]);

  // ── API handlers ─────────────────────────────────────────────────────────

  const handleApprove = useCallback(async (alwaysAllow: boolean) => {
    if (isSubmitting || status !== 'pending') return;
    setIsSubmitting(true);
    try {
      await apiClient.post(
        `/chat/conversations/${conversationId}/tools/${messageId}/approve`,
        { alwaysAllow },
      );
      setStatus('approved');
      setLocalApprovedAt(new Date().toISOString());
      onApprove?.(messageId, alwaysAllow);
    } catch (err) {
      console.error('[ToolApprovalBubble] Failed to approve:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, status, conversationId, messageId, onApprove]);

  const handleReject = useCallback(async () => {
    if (isSubmitting || status !== 'pending') return;
    setIsSubmitting(true);
    try {
      await apiClient.post(
        `/chat/conversations/${conversationId}/tools/${messageId}/reject`,
      );
      setStatus('rejected');
      onReject?.(messageId);
    } catch (err) {
      console.error('[ToolApprovalBubble] Failed to reject:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, status, conversationId, messageId, onReject]);

  // ── Styling ──────────────────────────────────────────────────────────────
  const styles = STATUS_STYLES[status];
  const hasArgs = args && Object.keys(args).length > 0;

  // ── Render: resolved states (approved / rejected / timeout) ─────────────
  if (status === 'approved') {
    return (
      <div
        ref={bubbleRef}
        className={cn('rounded-lg p-3 mb-2 border', styles.bg, styles.border)}
      >
        <div className="flex items-center gap-2">
          <Check className={cn('w-4 h-4', styles.icon)} />
          <span className={cn('text-sm font-medium', styles.icon)}>
            Tool Approved: {toolName}
          </span>
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          {localApprovedBy ? `Approved by ${localApprovedBy}` : 'Approved'}
          {localApprovedAt ? ` \u2022 ${formatTimeAgo(localApprovedAt)}` : ''}
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div
        ref={bubbleRef}
        className={cn('rounded-lg p-3 mb-2 border', styles.bg, styles.border)}
      >
        <div className="flex items-center gap-2">
          <X className={cn('w-4 h-4', styles.icon)} />
          <span className={cn('text-sm font-medium', styles.icon)}>
            Tool Rejected: {toolName}
          </span>
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          {localApprovedBy ? `Rejected by ${localApprovedBy}` : 'Rejected'}
          {localApprovedAt ? ` \u2022 ${formatTimeAgo(localApprovedAt)}` : ''}
        </div>
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div
        ref={bubbleRef}
        className={cn('rounded-lg p-3 mb-2 border', styles.bg, styles.border)}
      >
        <div className="flex items-center gap-2">
          <Clock className={cn('w-4 h-4', styles.icon)} />
          <span className={cn('text-sm font-medium', styles.icon)}>
            Tool Timed Out: {toolName}
          </span>
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          No response within {Math.floor(timeoutSeconds / 60)} minute{Math.floor(timeoutSeconds / 60) !== 1 ? 's' : ''}
        </div>
      </div>
    );
  }

  // ── Render: pending state ───────────────────────────────────────────────
  return (
    <div
      ref={bubbleRef}
      className={cn(
        'rounded-lg p-3 mb-2 border transition-shadow',
        styles.bg,
        styles.border,
        'animate-pulse-subtle',
      )}
      style={{
        // Subtle pulsing glow — defined inline to avoid adding global CSS
        animation: 'tool-approval-pulse 2s ease-in-out infinite',
      }}
    >
      {/* Inline keyframes for the pulse animation */}
      <style>{`
        @keyframes tool-approval-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
          50% { box-shadow: 0 0 12px 2px rgba(234, 179, 8, 0.15); }
        }
      `}</style>

      {/* Header row: icon + title + countdown */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-medium text-yellow-400">
            Tool Approval Required
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-yellow-400/80">
          <Clock className="w-3 h-3" />
          <span>{formatCountdown(remaining)} remaining</span>
        </div>
      </div>

      {/* Tool name */}
      <div className="text-sm text-[var(--text-secondary)] mb-2">
        Agent wants to execute:{' '}
        <span className="font-mono font-medium text-[var(--text-primary)]">{toolName}</span>
      </div>

      {/* Expandable arguments */}
      {hasArgs && (
        <div className="mb-3">
          <button
            onClick={() => setArgsExpanded(!argsExpanded)}
            className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            {argsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>View arguments</span>
          </button>
          {argsExpanded && (
            <pre className="mt-1.5 p-2 rounded bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto font-mono">
              {prettyPrintArgs(args)}
            </pre>
          )}
        </div>
      )}

      {/* Warning for dangerous tools */}
      <div className="flex items-start gap-1.5 mb-3 text-[11px] text-yellow-500/70">
        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>This tool requires explicit approval before execution.</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleApprove(false)}
          disabled={isSubmitting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            'bg-green-600 hover:bg-green-500 text-white',
            isSubmitting && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Check className="w-3.5 h-3.5" />
          Allow
        </button>

        <button
          onClick={handleReject}
          disabled={isSubmitting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            'bg-red-600 hover:bg-red-500 text-white',
            isSubmitting && 'opacity-50 cursor-not-allowed',
          )}
        >
          <X className="w-3.5 h-3.5" />
          Deny
        </button>

        <button
          onClick={() => handleApprove(true)}
          disabled={isSubmitting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            'bg-yellow-600/80 hover:bg-yellow-500/80 text-white',
            isSubmitting && 'opacity-50 cursor-not-allowed',
          )}
          title="Create a permanent rule to always allow this tool without future prompts"
        >
          <Unlock className="w-3.5 h-3.5" />
          Always Allow
        </button>
      </div>
    </div>
  );
};
