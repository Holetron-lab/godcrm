/**
 * InvitationAcceptPage - ADR-105 (AC8)
 *
 * Semi-public page for accepting space invitations.
 * Route: /invitations/:token
 *
 * Behaviour:
 * - Fetches invitation details by token (works without auth)
 * - If user is logged in: shows "Accept Invitation" button
 * - If not logged in: shows "Login to accept" button with return URL
 * - Handles error states: expired, already accepted, invalid token, revoked
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { spacesApi } from '@/features/spaces/api/spacesApi';
import type { InvitationDetails } from '@/features/spaces/types/space.types';
import {
  Mail,
  UserPlus,
  LogIn,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Ban
} from 'lucide-react';

/** Role display configuration */
const ROLE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  admin: {
    label: 'Admin',
    color: 'text-purple-400',
    description: 'Full management access'
  },
  editor: {
    label: 'Editor',
    color: 'text-blue-400',
    description: 'Can view and edit content'
  },
  viewer: {
    label: 'Viewer',
    color: 'text-emerald-400',
    description: 'Read-only access'
  }
};

export function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isLoggedIn = !!user;

  const [accepted, setAccepted] = useState(false);
  const [acceptedSpaceId, setAcceptedSpaceId] = useState<number | null>(null);

  // ─── Query: Fetch invitation details ────────────────────────────
  const {
    data: invitation,
    isLoading,
    error: fetchError
  } = useQuery<InvitationDetails>({
    queryKey: ['invitation', token],
    queryFn: () => spacesApi.getInvitationByToken(token!),
    enabled: !!token,
    retry: false
  });

  // ─── Mutation: Accept invitation ────────────────────────────────
  const acceptMutation = useMutation({
    mutationFn: () => spacesApi.acceptInvitation(token!),
    onSuccess: (data) => {
      setAccepted(true);
      setAcceptedSpaceId(data.space_id);
    }
  });

  // ─── Handlers ───────────────────────────────────────────────────

  const handleAccept = useCallback(() => {
    acceptMutation.mutate();
  }, [acceptMutation]);

  const handleLoginRedirect = useCallback(() => {
    // Navigate to login with return path so user comes back after auth
    navigate('/auth/login', {
      state: { from: `/invitations/${token}` }
    });
  }, [navigate, token]);

  const handleGoToSpace = useCallback(() => {
    if (acceptedSpaceId) {
      navigate(`/spaces/${acceptedSpaceId}/dashboard`);
    } else {
      navigate('/spaces');
    }
  }, [navigate, acceptedSpaceId]);

  // ─── Derived state ─────────────────────────────────────────────

  const isExpired = invitation
    ? new Date(invitation.expires_at) < new Date()
    : false;
  const isInvalidStatus =
    invitation?.status === 'accepted' ||
    invitation?.status === 'expired' ||
    invitation?.status === 'revoked';
  const canAccept = invitation?.status === 'pending' && !isExpired && !accepted;
  const roleConfig = invitation ? ROLE_CONFIG[invitation.role] : null;

  // ─── Parse error message ───────────────────────────────────────

  const getErrorMessage = (): string => {
    if (!fetchError) return '';
    const msg = (fetchError as Error).message || '';
    try {
      const parsed = JSON.parse(msg);
      return parsed.error || parsed.message || 'Invalid or expired invitation link';
    } catch {
      if (msg.includes('404') || msg.includes('not found')) {
        return 'This invitation link is invalid or has been removed.';
      }
      return msg || 'Failed to load invitation details';
    }
  };

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-[var(--border-primary)] bg-gradient-to-b from-[var(--accent-primary)]/5 to-transparent">
            <div className="flex items-center justify-center mb-3">
              <div className="w-12 h-12 rounded-full bg-[var(--accent-primary)]/10 flex items-center justify-center">
                <Mail className="w-6 h-6 text-[var(--accent-primary)]" />
              </div>
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)] text-center">
              Space Invitation
            </h1>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {/* Loading */}
            {isLoading && (
              <div className="flex flex-col items-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-primary)] mb-3" />
                <p className="text-sm text-[var(--text-tertiary)]">
                  Loading invitation details...
                </p>
              </div>
            )}

            {/* Error / Invalid Token */}
            {fetchError && !isLoading && (
              <div className="flex flex-col items-center py-6">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
                  <XCircle className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                  Invalid Invitation
                </h2>
                <p className="text-xs text-[var(--text-tertiary)] text-center max-w-xs">
                  {getErrorMessage()}
                </p>
                <Link
                  to="/auth/login"
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  Go to Login
                </Link>
              </div>
            )}

            {/* Invitation Loaded - Show Details */}
            {invitation && !isLoading && !fetchError && (
              <div className="space-y-4">
                {/* Invitation Info */}
                <div className="space-y-3">
                  {/* Space Name */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                    <div className="w-8 h-8 rounded-md bg-[var(--accent-primary)]/10 flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-[var(--accent-primary)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--text-tertiary)]">Space</p>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {invitation.space_name}
                      </p>
                    </div>
                  </div>

                  {/* Inviter */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                    <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
                      <UserPlus className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--text-tertiary)]">Invited by</p>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {invitation.invited_by_name}
                      </p>
                    </div>
                  </div>

                  {/* Role */}
                  {roleConfig && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                      <div className="w-8 h-8 rounded-md bg-purple-500/10 flex items-center justify-center shrink-0">
                        <Clock className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-[var(--text-tertiary)]">Role granted</p>
                        <p className={`text-sm font-medium ${roleConfig.color}`}>
                          {roleConfig.label}
                          <span className="text-[var(--text-tertiary)] font-normal ml-1.5">
                            - {roleConfig.description}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Status-based Actions */}

                {/* Already Accepted */}
                {invitation.status === 'accepted' && !accepted && (
                  <div className="flex flex-col items-center py-3">
                    <div className="flex items-center gap-2 text-emerald-400 mb-2">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="text-sm font-medium">Already Accepted</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] text-center mb-3">
                      This invitation has already been accepted.
                    </p>
                    <button
                      type="button"
                      onClick={handleGoToSpace}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors"
                    >
                      Go to Space
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Expired */}
                {(invitation.status === 'expired' || (invitation.status === 'pending' && isExpired)) && (
                  <div className="flex flex-col items-center py-3">
                    <div className="flex items-center gap-2 text-amber-400 mb-2">
                      <AlertTriangle className="w-5 h-5" />
                      <span className="text-sm font-medium">Invitation Expired</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] text-center">
                      This invitation has expired. Please ask the space owner to send a new one.
                    </p>
                  </div>
                )}

                {/* Revoked */}
                {invitation.status === 'revoked' && (
                  <div className="flex flex-col items-center py-3">
                    <div className="flex items-center gap-2 text-red-400 mb-2">
                      <Ban className="w-5 h-5" />
                      <span className="text-sm font-medium">Invitation Revoked</span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] text-center">
                      This invitation has been revoked by the space administrator.
                    </p>
                  </div>
                )}

                {/* Can Accept - User Logged In */}
                {canAccept && isLoggedIn && !accepted && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={acceptMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {acceptMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Accept Invitation
                    </button>
                    {acceptMutation.isError && (
                      <p className="mt-2 text-xs text-red-400 text-center">
                        {(acceptMutation.error as Error).message || 'Failed to accept invitation'}
                      </p>
                    )}
                  </div>
                )}

                {/* Can Accept - User NOT Logged In */}
                {canAccept && !isLoggedIn && !accepted && (
                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      onClick={handleLoginRedirect}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors"
                    >
                      <LogIn className="w-4 h-4" />
                      Login to Accept
                    </button>
                    <p className="text-xs text-[var(--text-tertiary)] text-center">
                      You need to log in or create an account to accept this invitation.
                    </p>
                  </div>
                )}

                {/* Successfully Accepted */}
                {accepted && (
                  <div className="flex flex-col items-center py-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    </div>
                    <h2 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                      You&apos;ve been added to {invitation.space_name}!
                    </h2>
                    <p className="text-xs text-[var(--text-tertiary)] text-center mb-4">
                      You now have <span className="font-medium">{roleConfig?.label}</span> access to this space.
                    </p>
                    <button
                      type="button"
                      onClick={handleGoToSpace}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors"
                    >
                      Go to Space
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
            <p className="text-xs text-[var(--text-tertiary)] text-center">
              Powered by{' '}
              <a
                href="https://crm.hltrn.cc"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                GOD CRM
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
