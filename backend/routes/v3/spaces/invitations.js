/**
 * Spaces Invitations Routes (ADR-105)
 * GET /:id/invitations, POST /:id/invitations,
 * DELETE /:id/invitations/:invitationId, POST /:id/invitations/:invitationId/resend,
 * GET /invitations/:token, POST /invitations/:token/accept
 */

import { getInvitationsBySpace, createInvitation, revokeInvitation, resendInvitation, getInvitationByToken, acceptInvitation } from '../../../services/InvitationService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';
import { requireOwnerOrAdmin } from './visibility.js';

export default function registerInvitationRoutes(router) {
  /**
   * GET /spaces/:id/invitations
   * List all invitations for a space.
   * Requires admin+ access to the space.
   */
  router.get('/:id/invitations', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const invitations = await getInvitationsBySpace(result.space.id);

      success(res, invitations);
    } catch (err) {
      apiLogger.error('Error fetching invitations:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  /**
   * POST /spaces/:id/invitations
   * Create a new invitation for a space.
   * Body: { email, role }
   * Requires admin+ access to the space.
   */
  router.post('/:id/invitations', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const { email, role } = req.body;

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return badRequest(res, 'A valid email address is required', 'VALIDATION_ERROR');
      }

      if (!role) {
        return badRequest(res, 'role is required', 'VALIDATION_ERROR');
      }

      const invitation = await createInvitation(result.space.id, req.user.id, email, role);

      created(res, invitation);
    } catch (err) {
      apiLogger.error('Error creating invitation:', err);

      if (err.message.includes('Invalid role') || err.message.includes('required') || err.message.includes('already exists')) {
        return badRequest(res, err.message, 'VALIDATION_ERROR');
      }

      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  /**
   * DELETE /spaces/:id/invitations/:invitationId
   * Revoke a pending invitation.
   * Requires admin+ access to the space.
   */
  router.delete('/:id/invitations/:invitationId', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const invitationId = parseInt(req.params.invitationId);

      if (!invitationId || isNaN(invitationId)) {
        return badRequest(res, 'Valid invitationId is required', 'VALIDATION_ERROR');
      }

      const revokeResult = await revokeInvitation(invitationId, req.user.id);

      success(res, revokeResult);
    } catch (err) {
      apiLogger.error('Error revoking invitation:', err);

      if (err.message.includes('not found')) {
        return notFound(res, 'Invitation');
      }
      if (err.message.includes('Cannot revoke')) {
        return badRequest(res, err.message, 'VALIDATION_ERROR');
      }

      error(res, 'DELETE_ERROR', err.message, 500);
    }
  });

  /**
   * POST /spaces/:id/invitations/:invitationId/resend
   * Resend an invitation (regenerate token and extend expiry).
   * Requires admin+ access to the space.
   */
  router.post('/:id/invitations/:invitationId/resend', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const invitationId = parseInt(req.params.invitationId);

      if (!invitationId || isNaN(invitationId)) {
        return badRequest(res, 'Valid invitationId is required', 'VALIDATION_ERROR');
      }

      const updated = await resendInvitation(invitationId, req.user.id);

      success(res, updated);
    } catch (err) {
      apiLogger.error('Error resending invitation:', err);

      if (err.message.includes('not found')) {
        return notFound(res, 'Invitation');
      }
      if (err.message.includes('Cannot resend')) {
        return badRequest(res, err.message, 'VALIDATION_ERROR');
      }

      error(res, 'RESEND_ERROR', err.message, 500);
    }
  });

  // ============================================================
  // Invitation Acceptance (ADR-105)
  // Routes: /spaces/invitations/:token (mounted under /api/v3/spaces)
  // ============================================================

  /**
   * GET /spaces/invitations/:token
   * Get invitation details by token. Auth required to see full details.
   */
  router.get('/invitations/:token', async (req, res) => {
    try {
      const { token } = req.params;

      if (!token) {
        return badRequest(res, 'Invitation token is required', 'VALIDATION_ERROR');
      }

      const invitation = await getInvitationByToken(token);

      if (!invitation) {
        return notFound(res, 'Invitation');
      }

      success(res, invitation);
    } catch (err) {
      apiLogger.error('Error fetching invitation by token:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  /**
   * POST /spaces/invitations/:token/accept
   * Accept an invitation. Auth required.
   */
  router.post('/invitations/:token/accept', async (req, res) => {
    try {
      const { token } = req.params;

      if (!token) {
        return badRequest(res, 'Invitation token is required', 'VALIDATION_ERROR');
      }

      const result = await acceptInvitation(token);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error accepting invitation:', err);

      if (err.message.includes('not found') || err.message.includes('already used')) {
        return notFound(res, 'Invitation');
      }
      if (err.message.includes('expired')) {
        return badRequest(res, err.message, 'INVITATION_EXPIRED');
      }
      if (err.message.includes('must register')) {
        return badRequest(res, err.message, 'USER_NOT_REGISTERED');
      }

      error(res, 'ACCEPT_ERROR', err.message, 500);
    }
  });
}
