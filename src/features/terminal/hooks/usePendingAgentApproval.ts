/**
 * usePendingAgentApproval - ADR-0053 §Phase C UX
 * Polls /terminal/commands/pending and exposes the oldest pending command
 * with handlers for Approve / Reject / Always-Allow (writes _command_policies).
 * Mounted by the AI chat to render an inline approval bar above the input.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveCommand,
  rejectCommand,
  listPendingCommands,
  type PendingCommand,
} from '../api/terminalApi';
import { addCommandPolicy } from '../api/commandPolicyApi';

const POLL_MS = 4_000;

export interface UsePendingAgentApprovalResult {
  pending: PendingCommand | null;
  approve: () => void;
  reject: () => void;
  alwaysAllow: () => void;
  isApproving: boolean;
  isRejecting: boolean;
  isPolicyWriting: boolean;
  policyError: string | null;
  clearError: () => void;
}

export function usePendingAgentApproval(enabled = true): UsePendingAgentApprovalResult {
  const queryClient = useQueryClient();
  const [policyError, setPolicyError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['terminal', 'commands', 'pending'],
    queryFn: listPendingCommands,
    enabled,
    refetchInterval: POLL_MS,
    staleTime: 1_000,
  });

  const pending = query.data?.[0] ?? null;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['terminal', 'commands', 'pending'] });
    queryClient.invalidateQueries({ queryKey: ['terminal', 'commands'] });
  }, [queryClient]);

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveCommand(id),
    onSettled: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectCommand(id),
    onSettled: invalidate,
  });
  const policyMutation = useMutation({
    mutationFn: (cmd: string) =>
      addCommandPolicy({
        scope: 'global',
        pattern: cmd,
        match_type: 'exact',
        action: 'allow',
        reason: 'Approved via chat approval bar',
      }),
  });

  const approve = useCallback(() => {
    if (!pending) return;
    setPolicyError(null);
    approveMutation.mutate(pending.id);
  }, [pending, approveMutation]);

  const reject = useCallback(() => {
    if (!pending) return;
    setPolicyError(null);
    rejectMutation.mutate(pending.id);
  }, [pending, rejectMutation]);

  const alwaysAllow = useCallback(async () => {
    if (!pending) return;
    setPolicyError(null);
    try {
      await policyMutation.mutateAsync(pending.command);
      approveMutation.mutate(pending.id);
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : 'Failed to save allow rule');
    }
  }, [pending, policyMutation, approveMutation]);

  return {
    pending,
    approve,
    reject,
    alwaysAllow,
    isApproving: approveMutation.isPending,
    isRejecting: rejectMutation.isPending,
    isPolicyWriting: policyMutation.isPending,
    policyError,
    clearError: () => setPolicyError(null),
  };
}
