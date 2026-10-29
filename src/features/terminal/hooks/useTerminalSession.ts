/**
 * useTerminalSession - ADR-076
 * Hook for managing a terminal session with TanStack Query polling.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createSession,
  getSession,
  closeSession as apiClose,
  executeCommand as apiExecute,
  approveCommand as apiApprove,
  rejectCommand as apiReject,
  getCommands,
  listSessions,
} from '../api/terminalApi';
import type { TerminalSession, TerminalCommand } from '../api/terminalApi';

const POLL_INTERVAL = 3000;

export function useTerminalSession() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const lastCommandIdRef = useRef(0);
  const creatingRef = useRef(false); // guard against double-create

  // List sessions (only active) — poll so agent-created tabs appear automatically
  const sessionsQuery = useQuery({
    queryKey: ['terminal', 'sessions'],
    queryFn: listSessions,
    staleTime: 5_000,
    refetchInterval: 5_000,
    select: (data) => data.filter(s => s.status === 'active'),
  });

  const activeSessions = sessionsQuery.data ?? [];

  // Get current session details
  const sessionQuery = useQuery({
    queryKey: ['terminal', 'session', sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 5_000,
  });

  // Poll for new commands
  const commandsQuery = useQuery({
    queryKey: ['terminal', 'commands', sessionId, lastCommandIdRef.current],
    queryFn: () => getCommands(sessionId!, lastCommandIdRef.current),
    enabled: !!sessionId,
    refetchInterval: POLL_INTERVAL,
    staleTime: 1_000,
  });

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (title?: string) => createSession(title),
    onSuccess: (session) => {
      creatingRef.current = false;
      setSessionId(session.id);
      lastCommandIdRef.current = 0;
      queryClient.invalidateQueries({ queryKey: ['terminal', 'sessions'] });
    },
    onError: () => {
      creatingRef.current = false;
    },
  });

  // Close session mutation
  const closeSessionMutation = useMutation({
    mutationFn: (id: number) => apiClose(id),
    onSuccess: (_data, closedId) => {
      queryClient.invalidateQueries({ queryKey: ['terminal', 'sessions'] });
      // If we closed the active session, switch to another
      if (closedId === sessionId) {
        const remaining = activeSessions.filter(s => s.id !== closedId);
        if (remaining.length > 0) {
          setSessionId(remaining[0].id);
          lastCommandIdRef.current = 0;
        } else {
          setSessionId(null);
        }
      }
    },
  });

  // Execute command mutation
  const executeMutation = useMutation({
    mutationFn: ({ command, source, agentName }: {
      command: string;
      source?: string;
      agentName?: string;
    }) => apiExecute(sessionId!, command, { source, agentName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal', 'commands', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['terminal', 'session', sessionId] });
    },
  });

  // Approve / reject: the pending row lives in the session query (the poll only
  // returns ids above the pending one), so refresh the session too — otherwise
  // the row stays 'pending' client-side and the approval dialog re-arms forever.
  const refreshCommands = () => {
    queryClient.invalidateQueries({ queryKey: ['terminal', 'commands', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['terminal', 'session', sessionId] });
  };
  const approveMutation = useMutation({
    mutationFn: (commandId: number) => apiApprove(commandId),
    onSettled: refreshCommands,
  });
  const rejectMutation = useMutation({
    mutationFn: (commandId: number) => apiReject(commandId),
    onSettled: refreshCommands,
  });

  // --- Actions ---

  const doCreateSession = useCallback((title?: string) => {
    if (creatingRef.current) return; // prevent double-fire
    creatingRef.current = true;
    createSessionMutation.mutate(title);
  }, [createSessionMutation]);

  const doCloseSession = useCallback((id: number) => {
    closeSessionMutation.mutate(id);
  }, [closeSessionMutation]);

  const doCloseOthers = useCallback((keepId: number) => {
    activeSessions
      .filter(s => s.id !== keepId)
      .forEach(s => closeSessionMutation.mutate(s.id));
  }, [activeSessions, closeSessionMutation]);

  const doCloseToTheRight = useCallback((targetId: number) => {
    const idx = activeSessions.findIndex(s => s.id === targetId);
    if (idx < 0) return;
    activeSessions.slice(idx + 1).forEach(s => closeSessionMutation.mutate(s.id));
  }, [activeSessions, closeSessionMutation]);

  const doCloseToTheLeft = useCallback((targetId: number) => {
    const idx = activeSessions.findIndex(s => s.id === targetId);
    if (idx <= 0) return;
    activeSessions.slice(0, idx).forEach(s => closeSessionMutation.mutate(s.id));
  }, [activeSessions, closeSessionMutation]);

  const doCloseAll = useCallback(() => {
    activeSessions.forEach(s => closeSessionMutation.mutate(s.id));
    setSessionId(null);
  }, [activeSessions, closeSessionMutation]);

  const execute = useCallback((command: string, source = 'user', agentName?: string) => {
    if (!command.trim()) return;
    setCommandHistory(prev => [...prev, command]);
    executeMutation.mutate({ command, source, agentName });
  }, [executeMutation]);

  const approve = useCallback((commandId: number) => {
    approveMutation.mutate(commandId);
  }, [approveMutation]);

  const reject = useCallback((commandId: number) => {
    rejectMutation.mutate(commandId);
  }, [rejectMutation]);

  const switchSession = useCallback((id: number) => {
    setSessionId(id);
    lastCommandIdRef.current = 0;
  }, []);

  // Merge session commands with polled commands. Memoized: consumers key
  // effects on this array, and a fresh array per render re-fired them on
  // every render (the approval dialog looped on setState).
  const sessionCommands = sessionQuery.data?.commands;
  const polledCommands = commandsQuery.data;
  const allCommands = useMemo<TerminalCommand[]>(() => [
    ...(sessionCommands ?? []),
    ...(polledCommands ?? []),
  ].reduce<TerminalCommand[]>((acc, cmd) => {
    if (!acc.find(c => c.id === cmd.id)) acc.push(cmd);
    return acc;
  }, []), [sessionCommands, polledCommands]);

  // Track last command ID for polling
  if (allCommands.length > 0) {
    const maxId = Math.max(...allCommands.map(c => c.id));
    if (maxId > lastCommandIdRef.current) {
      lastCommandIdRef.current = maxId;
    }
  }

  return {
    // Session
    sessionId,
    session: sessionQuery.data,
    sessions: activeSessions,
    sessionsLoaded: sessionsQuery.isFetched,
    isLoading: sessionQuery.isLoading,

    // Commands
    commands: allCommands,
    commandHistory,

    // Actions
    createSession: doCreateSession,
    closeSession: doCloseSession,
    closeOthers: doCloseOthers,
    closeToTheRight: doCloseToTheRight,
    closeToTheLeft: doCloseToTheLeft,
    closeAll: doCloseAll,
    execute,
    approve,
    reject,
    switchSession,

    // Mutation states
    isExecuting: executeMutation.isPending,
    isApproving: approveMutation.isPending,
    isRejecting: rejectMutation.isPending,
  };
}
