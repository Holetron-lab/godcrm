/**
 * CommandApprovalDialog - ADR-076 (+ ADR-0053 "Always Allow" button)
 * Shows when a dangerous command needs user approval.
 * Uses the same visual pattern as ConfirmDialog from Labs.
 */

import { AlertTriangle, ShieldAlert, Check, X, ShieldCheck, Bot, User } from 'lucide-react';

interface CommandApprovalDialogProps {
  isOpen: boolean;
  command: string;
  riskLevel: string;
  /** Display name of who issued the command (e.g. agent slug, or 'You'). */
  issuerLabel?: string | null;
  /** When true, render the issuer chip with the agent (purple/bot) styling. */
  issuerIsAgent?: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Approve once AND write an allow rule into _command_policies for this exact command. */
  onAlwaysAllow?: () => void;
  isApproving?: boolean;
  isPolicyWriting?: boolean;
  policyError?: string | null;
}

export function CommandApprovalDialog({
  isOpen,
  command,
  riskLevel,
  issuerLabel,
  issuerIsAgent,
  onApprove,
  onReject,
  onAlwaysAllow,
  isApproving,
  isPolicyWriting,
  policyError,
}: CommandApprovalDialogProps) {
  if (!isOpen) return null;
  const busy = isApproving || isPolicyWriting;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onReject} />

      {/* Dialog */}
      <div className="relative bg-slate-900 border border-red-500/20 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-white mb-1">
                Dangerous Command
              </h3>
              <p className="text-slate-400 text-sm mb-3">
                This command has been classified as <span className="text-red-400 font-semibold">{riskLevel}</span> and requires your approval before execution.
              </p>
            </div>
          </div>

          {/* Command preview */}
          <div className="mt-3 bg-slate-800 border border-slate-700 rounded-lg p-3 font-mono text-sm">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-red-400 text-xs font-bold uppercase">{riskLevel}</span>
              {issuerLabel && (
                <span
                  className={
                    'ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase border ' +
                    (issuerIsAgent
                      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                      : 'bg-slate-500/15 text-slate-300 border-slate-500/30')
                  }
                  title={issuerIsAgent ? 'Command issued by an agent' : 'Command issued by you'}
                >
                  {issuerIsAgent ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                  <span className="truncate max-w-[140px]">{issuerLabel}</span>
                </span>
              )}
            </div>
            <code className="text-slate-200 break-all">{command}</code>
          </div>
        </div>

        {/* Policy write error */}
        {policyError && (
          <div className="mx-6 mb-2 px-3 py-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded">
            {policyError}
          </div>
        )}

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-800/50 flex flex-wrap gap-3 justify-end">
          <button
            onClick={onReject}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          {onAlwaysAllow && (
            <button
              onClick={onAlwaysAllow}
              disabled={busy}
              title="Approve this command and add it to the allow-list so future identical invocations skip the prompt."
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {isPolicyWriting ? 'Saving rule…' : 'Always Allow'}
            </button>
          )}
          <button
            onClick={onApprove}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {isApproving ? 'Executing...' : 'Approve & Execute'}
          </button>
        </div>
      </div>
    </div>
  );
}
