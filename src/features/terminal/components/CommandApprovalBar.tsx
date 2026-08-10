/**
 * CommandApprovalBar — ADR-0053 §Phase C UX
 * Inline strip (yellow/amber) that lives above the AI chat input, in the same
 * slot as the polling-error banner. Shows the pending command, who issued it
 * (User vs Agent name), and three actions: Reject / Always Allow / Approve.
 */
import { AlertTriangle, Bot, User, Check, X, ShieldCheck } from 'lucide-react';
import type { PendingCommand } from '../api/terminalApi';

interface CommandApprovalBarProps {
  pending: PendingCommand;
  onApprove: () => void;
  onReject: () => void;
  onAlwaysAllow: () => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isPolicyWriting?: boolean;
  policyError?: string | null;
}

export function CommandApprovalBar({
  pending,
  onApprove,
  onReject,
  onAlwaysAllow,
  isApproving,
  isRejecting,
  isPolicyWriting,
  policyError,
}: CommandApprovalBarProps) {
  const busy = isApproving || isRejecting || isPolicyWriting;
  const isAgent = pending.source === 'agent';
  const issuer = isAgent
    ? (pending.agent_name || pending.session_title || 'Agent')
    : 'You';

  return (
    <div className="px-3 py-2 bg-amber-500/10 border-t border-amber-500/30">
      <div className="flex flex-wrap items-center gap-2 text-amber-300 text-[12px]">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {/* Issuer chip */}
        <span
          className={
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ' +
            (isAgent
              ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
              : 'bg-slate-500/15 text-slate-300 border border-slate-500/30')
          }
          title={isAgent ? 'Command issued by an agent' : 'Command issued by you'}
        >
          {isAgent ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
          <span className="truncate max-w-[140px]">{issuer}</span>
        </span>
        <span className="text-amber-400 text-[10px] font-bold uppercase">
          {pending.risk_level}
        </span>
        {/* Command preview */}
        <code className="flex-1 min-w-[120px] truncate font-mono text-[12px] text-amber-100 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
          {pending.command}
        </code>
        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={onReject}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-slate-700/60 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            <X className="w-3 h-3" />
            {isRejecting ? '…' : 'Reject'}
          </button>
          <button
            onClick={onAlwaysAllow}
            disabled={busy}
            title="Approve this exact command and add it to the allow-list."
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-amber-600/80 text-white hover:bg-amber-600 disabled:opacity-50"
          >
            <ShieldCheck className="w-3 h-3" />
            {isPolicyWriting ? 'Saving…' : 'Always Allow'}
          </button>
          <button
            onClick={onApprove}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            {isApproving ? 'Running…' : 'Approve'}
          </button>
        </div>
      </div>
      {policyError && (
        <div className="mt-1 text-[11px] text-red-300">{policyError}</div>
      )}
    </div>
  );
}
