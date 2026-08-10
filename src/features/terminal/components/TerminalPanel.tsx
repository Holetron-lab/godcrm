/**
 * TerminalPanel - ADR-076
 * Full terminal panel: tab bar + output + input + approval dialog.
 * Can be used standalone, in a widget, or embedded in AI Chat.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { TerminalOutput } from './TerminalOutput';
import { TerminalInput } from './TerminalInput';
import { CommandApprovalDialog } from './CommandApprovalDialog';
import { useTerminalSession } from '../hooks/useTerminalSession';
import { addCommandPolicy } from '../api/commandPolicyApi';
import { Terminal, Plus, X, Bot, Minus } from 'lucide-react';

interface TerminalPanelProps {
  className?: string;
  defaultTitle?: string;
  compact?: boolean;
  /** When set, auto-switch to this session */
  focusSessionId?: number;
  /** Called when user clicks collapse/minimize */
  onCollapse?: () => void;
}

/** Right-click context menu state */
interface ContextMenu {
  x: number;
  y: number;
  sessionId: number;
}

export function TerminalPanel({ className = '', defaultTitle, compact = false, focusSessionId, onCollapse }: TerminalPanelProps) {
  const queryClient = useQueryClient();
  const {
    sessionId,
    session,
    sessions,
    commands,
    commandHistory,
    createSession,
    closeSession,
    closeOthers,
    closeToTheRight,
    closeToTheLeft,
    closeAll,
    execute,
    approve,
    reject,
    switchSession,
    isExecuting,
    isApproving,
    sessionsLoaded,
  } = useTerminalSession();

  const [pendingApproval, setPendingApproval] = useState<{
    commandId: number;
    command: string;
    riskLevel: string;
    source: 'user' | 'agent';
    agentName: string | null;
  } | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const initRef = useRef(false);

  const policyMutation = useMutation({
    mutationFn: (cmd: string) => addCommandPolicy({
      scope: 'global',
      pattern: cmd,
      match_type: 'exact',
      action: 'allow',
      reason: 'Approved via terminal dialog',
    }),
  });

  // Auto-select existing session or create one — only AFTER query loads
  // Bug #74147: Prefer user-created sessions; agent sessions (title "Agent #...")
  // are filtered by the backend, but add a defensive client-side check too.
  // Skip auto-init when focusSessionId is provided — let the focus effect handle it.
  useEffect(() => {
    if (initRef.current || sessionId || !sessionsLoaded || focusSessionId) return;
    initRef.current = true;
    const userSessions = sessions.filter(s => !s.title?.startsWith('Agent #'));
    if (userSessions.length > 0) {
      switchSession(userSessions[0].id);
    } else if (sessions.length > 0) {
      switchSession(sessions[0].id);
    } else {
      createSession(defaultTitle ?? 'Terminal');
    }
  }, [sessionsLoaded, sessions, sessionId, createSession, switchSession, defaultTitle]);

  // Focus on a specific session when requested (e.g. from chat tool_call link)
  // Always switch — even if the session isn't in the active list yet (it may appear on next poll,
  // or it may be an agent session that finished). The hook will load its commands regardless.
  // Focus on a specific session (e.g. agent terminal from chat bubble).
  // Use a counter to force re-trigger even if the same sessionId is clicked again.
  const lastFocusRef = useRef<number | undefined>();
  useEffect(() => {
    if (focusSessionId && sessionsLoaded) {
      lastFocusRef.current = focusSessionId;
      switchSession(focusSessionId);
      initRef.current = true; // prevent auto-init from overriding
      queryClient.invalidateQueries({ queryKey: ['terminal', 'sessions'] });
    }
  }, [focusSessionId, sessionsLoaded, switchSession]);

  // Check for pending approval commands
  useEffect(() => {
    const pending = commands.find(c => c.approval_status === 'pending');
    if (pending) {
      setPendingApproval({
        commandId: pending.id,
        command: pending.command,
        riskLevel: pending.risk_level,
        source: pending.source,
        agentName: pending.agent_name,
      });
    } else {
      setPendingApproval(null);
    }
  }, [commands]);

  // Close context menu on any click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  const handleApprove = useCallback(() => {
    if (pendingApproval) {
      approve(pendingApproval.commandId);
      setPendingApproval(null);
      setPolicyError(null);
    }
  }, [pendingApproval, approve]);

  const handleReject = useCallback(() => {
    if (pendingApproval) {
      reject(pendingApproval.commandId);
      setPendingApproval(null);
      setPolicyError(null);
    }
  }, [pendingApproval, reject]);

  const handleAlwaysAllow = useCallback(async () => {
    if (!pendingApproval) return;
    setPolicyError(null);
    try {
      await policyMutation.mutateAsync(pendingApproval.command);
      approve(pendingApproval.commandId);
      setPendingApproval(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save allow rule';
      setPolicyError(msg);
    }
  }, [pendingApproval, policyMutation, approve]);

  const handleNewSession = useCallback(() => {
    const n = sessions.length + 1;
    createSession(`Terminal ${n}`);
  }, [createSession, sessions.length]);

  const handleTabContext = useCallback((e: React.MouseEvent, sid: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: sid });
  }, []);

  const handleCloseTab = useCallback((e: React.MouseEvent, sid: number) => {
    e.stopPropagation();
    closeSession(sid);
  }, [closeSession]);

  return (
    <div className={`flex flex-col bg-slate-950 text-slate-200 rounded-lg border border-slate-800 overflow-hidden ${className}`}>
      {/* Tab bar */}
      {!compact && (
        <div className="flex items-center bg-slate-900/80 border-b border-slate-800 shrink-0 min-h-[36px]">
          {/* Tabs — horizontal scroll */}
          <div className="flex-1 flex items-center overflow-x-auto scrollbar-none min-w-0">
            {sessions.map(s => {
              // Bug #74147: Visual distinction for agent sessions
              const isAgentSession = s.title?.startsWith('Agent #');
              return (
              <button
                key={s.id}
                onClick={() => switchSession(s.id)}
                onContextMenu={(e) => handleTabContext(e, s.id)}
                className={`group relative flex items-center gap-1.5 shrink-0 px-3 py-2 text-[12px] border-r border-slate-800 transition-colors ${
                  s.id === sessionId
                    ? isAgentSession
                      ? 'bg-slate-950 text-purple-400'
                      : 'bg-slate-950 text-green-400'
                    : isAgentSession
                      ? 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/50'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                {isAgentSession ? (
                  <Bot className="w-3 h-3 shrink-0 text-purple-400" />
                ) : (
                  <Terminal className="w-3 h-3 shrink-0" />
                )}
                <span className={`truncate max-w-[100px] ${isAgentSession ? 'text-[11px] italic' : ''}`}>{s.title}</span>
                {/* Close X on hover (or always for active) */}
                <span
                  onClick={(e) => handleCloseTab(e, s.id)}
                  className={`shrink-0 p-0.5 rounded hover:bg-slate-700 transition-colors ${
                    s.id === sessionId ? 'text-slate-500 hover:text-slate-200' : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300'
                  }`}
                >
                  <X className="w-3 h-3" />
                </span>
                {/* Active indicator — Bug #74147: purple for agent, green for user */}
                {s.id === sessionId && (
                  <div className={`absolute bottom-0 left-0 right-0 h-[2px] ${isAgentSession ? 'bg-purple-400' : 'bg-green-400'}`} />
                )}
              </button>
              );
            })}
          </div>

          {/* New tab button */}
          <button
            onClick={handleNewSession}
            className="shrink-0 p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="New session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Collapse button */}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="shrink-0 p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Collapse terminal"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[100] bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={() => { closeSession(ctxMenu.sessionId); setCtxMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { closeOthers(ctxMenu.sessionId); setCtxMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-default"
            disabled={sessions.length <= 1}
          >
            Close Others
          </button>
          <button
            onClick={() => { closeToTheLeft(ctxMenu.sessionId); setCtxMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-default"
            disabled={sessions.findIndex(s => s.id === ctxMenu.sessionId) === 0}
          >
            Close to the Left
          </button>
          <button
            onClick={() => { closeToTheRight(ctxMenu.sessionId); setCtxMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-default"
            disabled={sessions.findIndex(s => s.id === ctxMenu.sessionId) === sessions.length - 1}
          >
            Close to the Right
          </button>
          <div className="border-t border-slate-700 my-1" />
          <button
            onClick={() => { closeAll(); setCtxMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700 transition-colors"
          >
            Close All
          </button>
        </div>
      )}

      {/* Output */}
      <TerminalOutput commands={commands} cwd={session?.cwd} />

      {/* Input */}
      <TerminalInput
        onSubmit={(cmd) => execute(cmd)}
        isExecuting={isExecuting}
        cwd={session?.cwd}
        history={commandHistory}
      />

      {/* Approval Dialog */}
      <CommandApprovalDialog
        isOpen={!!pendingApproval}
        command={pendingApproval?.command ?? ''}
        riskLevel={pendingApproval?.riskLevel ?? 'dangerous'}
        issuerLabel={pendingApproval ? (
          pendingApproval.source === 'agent'
            ? (pendingApproval.agentName || 'Agent')
            : 'You'
        ) : null}
        issuerIsAgent={pendingApproval?.source === 'agent'}
        onApprove={handleApprove}
        onReject={handleReject}
        onAlwaysAllow={handleAlwaysAllow}
        isApproving={isApproving}
        isPolicyWriting={policyMutation.isPending}
        policyError={policyError}
      />
    </div>
  );
}
