/**
 * SpaceInvitations - ADR-105 (AC8)
 * Invite users by email with role assignment, manage pending invitations.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import { spacesApi } from '../api/spacesApi';
import type { SpaceInvitation, CreateInvitationPayload } from '../types/space.types';
import {
  Mail,
  Send,
  RotateCcw,
  X,
  Loader2,
  AlertCircle,
  UserPlus,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Inbox
} from 'lucide-react';

interface SpaceInvitationsProps {
  spaceId: number;
}

type InvitationRole = CreateInvitationPayload['role'];

/** Status badge configuration */
const STATUS_CONFIG: Record<
  SpaceInvitation['status'],
  { label: string; className: string; icon: typeof Clock }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: Clock
  },
  accepted: {
    label: 'Accepted',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2
  },
  expired: {
    label: 'Expired',
    className: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
    icon: XCircle
  },
  revoked: {
    label: 'Revoked',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
    icon: Ban
  }
};

/** Role label mapping */
const ROLE_LABELS: Record<InvitationRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer'
};

/** Email validation */
const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

/** Format date to readable string */
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/** Check if invitation is expired based on expires_at */
const isExpiredDate = (expiresAt: string): boolean => {
  return new Date(expiresAt) < new Date();
};

export const SpaceInvitations = ({ spaceId }: SpaceInvitationsProps) => {
  const queryClient = useQueryClient();

  // ─── Local State ──────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('viewer');
  const [emailError, setEmailError] = useState('');

  // ─── Query: Fetch Invitations ─────────────────────────────────────
  const {
    data: invitations = [],
    isLoading,
    error: fetchError,
    refetch
  } = useQuery<SpaceInvitation[]>({
    queryKey: ['space-invitations', spaceId],
    queryFn: () => spacesApi.getInvitations(spaceId)
  });

  // ─── Mutation: Create Invitation ──────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: CreateInvitationPayload) =>
      spacesApi.createInvitation(spaceId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['space-invitations', spaceId] });
      showToast(`Invitation sent to ${variables.email}`, 'success');
      setEmail('');
      setEmailError('');
    },
    onError: (err: Error) => {
      const message = err.message || 'Failed to send invitation';
      // Try to parse JSON error message
      try {
        const parsed = JSON.parse(message);
        showToast(parsed.error || parsed.message || message, 'error');
      } catch {
        showToast(message, 'error');
      }
    }
  });

  // ─── Mutation: Revoke Invitation ──────────────────────────────────
  const revokeMutation = useMutation({
    mutationFn: (invitationId: number) =>
      spacesApi.revokeInvitation(spaceId, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-invitations', spaceId] });
      showToast('Invitation revoked', 'success');
    },
    onError: () => {
      showToast('Failed to revoke invitation', 'error');
    }
  });

  // ─── Mutation: Resend Invitation ──────────────────────────────────
  const resendMutation = useMutation({
    mutationFn: (invitationId: number) =>
      spacesApi.resendInvitation(spaceId, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-invitations', spaceId] });
      showToast('Invitation resent', 'success');
    },
    onError: () => {
      showToast('Failed to resend invitation', 'error');
    }
  });

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleSendInvitation = useCallback(() => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setEmailError('Email is required');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setEmailError('');
    createMutation.mutate({ email: trimmedEmail, role });
  }, [email, role, createMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendInvitation();
      }
    },
    [handleSendInvitation]
  );

  const isMutating =
    createMutation.isPending ||
    revokeMutation.isPending ||
    resendMutation.isPending;

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Invite Form ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="w-5 h-5 text-[var(--accent-primary)]" />
          <h4 className="text-sm font-medium text-[var(--text-primary)]">
            Invite User to Space
          </h4>
        </div>

        <div className="flex items-start gap-2">
          {/* Email Input */}
          <div className="flex-1 min-w-0">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="email@example.com"
                autoComplete="email"
                disabled={createMutation.isPending}
                className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 transition-colors ${
                  emailError
                    ? 'border-red-500/50 focus:ring-red-500/20 focus:border-red-500'
                    : 'border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]/20 focus:border-[var(--color-primary-500)]'
                } disabled:opacity-50`}
              />
            </div>
            {emailError && (
              <p className="mt-1 text-xs text-red-400">{emailError}</p>
            )}
          </div>

          {/* Role Selector */}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InvitationRole)}
            disabled={createMutation.isPending}
            className="shrink-0 px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 focus:border-[var(--color-primary-500)] disabled:opacity-50 cursor-pointer"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSendInvitation}
            disabled={createMutation.isPending || !email.trim()}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>Send</span>
          </button>
        </div>
      </div>

      {/* ── Pending Invitations Table ───────────────────────────── */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
          <Mail className="w-4 h-4 text-[var(--text-tertiary)]" />
          <h4 className="text-sm font-medium text-[var(--text-primary)]">
            Invitations
          </h4>
          <span className="text-xs text-[var(--text-tertiary)]">
            ({invitations.length})
          </span>
          {isMutating && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)] ml-auto" />
          )}
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
          </div>
        )}

        {/* Error State */}
        {fetchError && !isLoading && (
          <div className="flex items-center gap-2 text-red-400 p-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">Failed to load invitations</span>
            <button
              onClick={() => refetch()}
              className="ml-auto text-xs underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !fetchError && invitations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
            <Inbox className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No invitations yet</p>
            <p className="text-xs mt-1">
              Use the form above to invite users to this space
            </p>
          </div>
        )}

        {/* Table */}
        {!isLoading && !fetchError && invitations.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)] text-[var(--text-tertiary)]">
                  <th className="text-left font-medium px-4 py-2.5">Email</th>
                  <th className="text-left font-medium px-4 py-2.5">Role</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-left font-medium px-4 py-2.5">Sent</th>
                  <th className="text-left font-medium px-4 py-2.5">Expires</th>
                  <th className="text-right font-medium px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const statusCfg = STATUS_CONFIG[inv.status];
                  const StatusIcon = statusCfg.icon;
                  const expired = isExpiredDate(inv.expires_at);
                  // Use effective status: if server says pending but date is past, show expired
                  const effectiveStatus =
                    inv.status === 'pending' && expired ? 'expired' : inv.status;
                  const effectiveCfg = STATUS_CONFIG[effectiveStatus];
                  const EffectiveIcon = effectiveCfg.icon;

                  const canResend =
                    effectiveStatus === 'pending' || effectiveStatus === 'expired';
                  const canRevoke = effectiveStatus === 'pending';

                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--border-primary)] last:border-b-0 hover:bg-[var(--bg-primary)]/50 transition-colors"
                    >
                      {/* Email */}
                      <td className="px-4 py-2.5">
                        <span className="text-[var(--text-primary)] font-medium">
                          {inv.email}
                        </span>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-2.5">
                        <span className="text-[var(--text-secondary)] capitalize">
                          {ROLE_LABELS[inv.role]}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${effectiveCfg.className}`}
                        >
                          <EffectiveIcon className="w-3 h-3" />
                          {effectiveCfg.label}
                        </span>
                      </td>

                      {/* Sent Date */}
                      <td className="px-4 py-2.5 text-[var(--text-tertiary)]">
                        {formatDate(inv.created_at)}
                      </td>

                      {/* Expires Date */}
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            expired
                              ? 'text-red-400'
                              : 'text-[var(--text-tertiary)]'
                          }
                        >
                          {formatDate(inv.expires_at)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {canResend && (
                            <button
                              type="button"
                              onClick={() => resendMutation.mutate(inv.id)}
                              disabled={isMutating}
                              title="Resend invitation"
                              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {canRevoke && (
                            <button
                              type="button"
                              onClick={() => revokeMutation.mutate(inv.id)}
                              disabled={isMutating}
                              title="Revoke invitation"
                              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          {!canResend && !canRevoke && (
                            <span className="text-xs text-[var(--text-tertiary)] px-1.5">
                              --
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
