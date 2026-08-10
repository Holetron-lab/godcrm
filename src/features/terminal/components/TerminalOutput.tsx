/**
 * TerminalOutput - ADR-076
 * Renders command history with output, risk badges, and approval status.
 */

import { useEffect, useRef } from 'react';
import { parseAnsi } from '../utils/ansiParser';
import type { TerminalCommand } from '../api/terminalApi';

interface TerminalOutputProps {
  commands: TerminalCommand[];
  cwd?: string;
}

const RISK_BADGE: Record<string, { label: string; className: string }> = {
  safe: { label: '', className: '' },
  medium: { label: 'MEDIUM', className: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
  dangerous: { label: 'DANGEROUS', className: 'text-red-400 bg-red-400/10 border-red-400/30' },
};

function RiskBadge({ level }: { level: string }) {
  const badge = RISK_BADGE[level];
  if (!badge?.label) return null;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold border rounded ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function ApprovalStatus({ status }: { status: string }) {
  if (status === 'pending') {
    return <span className="text-yellow-400 text-xs animate-pulse">Awaiting approval...</span>;
  }
  if (status === 'rejected') {
    return <span className="text-red-400 text-xs">Rejected</span>;
  }
  if (status === 'approved') {
    return <span className="text-green-400 text-xs">Approved</span>;
  }
  return null;
}

function AnsiLine({ text }: { text: string }) {
  const spans = parseAnsi(text);
  return (
    <>
      {spans.map((span, i) => (
        <span key={i} className={span.className}>{span.text}</span>
      ))}
    </>
  );
}

export function TerminalOutput({ commands, cwd }: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commands]);

  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-sm leading-relaxed">
      {/* Help / Quick commands */}
      {commands.length === 0 && (
        <div className="text-slate-500 space-y-2">
          <div className="text-green-400 font-bold">GOD CRM Terminal</div>
          <div className="text-slate-400 text-xs mb-3">Quick commands:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div><span className="text-cyan-400">npm test</span> <span className="text-slate-600">— run tests</span></div>
            <div><span className="text-cyan-400">npm run dev</span> <span className="text-slate-600">— start dev server</span></div>
            <div><span className="text-cyan-400">npm run build</span> <span className="text-slate-600">— build frontend</span></div>
            <div><span className="text-cyan-400">git status</span> <span className="text-slate-600">— repo status</span></div>
            <div><span className="text-cyan-400">git log --oneline -10</span> <span className="text-slate-600">— recent commits</span></div>
            <div><span className="text-cyan-400">systemctl status business-crm-dev</span> <span className="text-slate-600">— backend status</span></div>
            <div><span className="text-cyan-400">ls -la</span> <span className="text-slate-600">— list files</span></div>
            <div><span className="text-cyan-400">df -h</span> <span className="text-slate-600">— disk usage</span></div>
          </div>
          <div className="text-slate-600 text-[10px] mt-2 border-t border-slate-800 pt-2">
            <span className="text-yellow-400/70">MEDIUM</span> commands log automatically &middot; <span className="text-red-400/70">DANGEROUS</span> commands require approval
          </div>
        </div>
      )}

      {commands.map((cmd) => (
        <div key={cmd.id} className="mb-2">
          {/* Command line */}
          <div className="flex items-center gap-2 flex-wrap">
            {cmd.source === 'agent' ? (
              <span className="text-purple-400 text-xs font-bold">BOT $</span>
            ) : (
              <span className="text-green-400">$</span>
            )}
            <span className="text-slate-200">{cmd.command}</span>
            <RiskBadge level={cmd.risk_level} />
            <ApprovalStatus status={cmd.approval_status} />
            {cmd.execution_time_ms != null && (
              <span className="text-slate-600 text-xs ml-auto">
                {cmd.execution_time_ms}ms
              </span>
            )}
          </div>

          {/* Running indicator */}
          {cmd.output == null && cmd.completed_at == null && cmd.approval_status !== 'pending' && (
            <div className="text-cyan-400 text-xs mt-0.5 pl-4 flex items-center gap-1.5 animate-pulse">
              <span className="inline-block w-1.5 h-1.5 bg-cyan-400 rounded-full" />
              Running...
            </div>
          )}

          {/* Output */}
          {cmd.output && (
            <div className="text-slate-300 whitespace-pre-wrap mt-0.5 pl-4">
              {cmd.output.split('\n').map((line, i) => (
                <div key={i}><AnsiLine text={line} /></div>
              ))}
            </div>
          )}

          {/* Exit code indicator */}
          {cmd.exit_code != null && cmd.exit_code !== 0 && cmd.approval_status !== 'pending' && (
            <div className="text-red-400 text-xs mt-0.5 pl-4">
              exit code: {cmd.exit_code}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
