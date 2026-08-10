// Invitation Service - v0.001.000
// Manages space invitations via email-based token flow (ADR-105)
import crypto from 'crypto';
import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { sendEmailWithFallback } from '../utils/email.js';

/**
 * Valid invitation statuses
 */
const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'];

/**
 * Valid invitation roles
 */
const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer'];

/**
 * Invitation expiry duration in days
 */
const EXPIRY_DAYS = 7;

/**
 * Access level hierarchy values (higher = more privileges)
 */
const ACCESS_LEVEL_VALUES = {
  owner_owner: 100,
  owner: 80,
  admin: 60,
  editor: 40,
  viewer: 20,
  denied: 0
};

/**
 * Generate a cryptographically secure invitation token
 * @returns {string} 64-character hex token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calculate expiration date from now
 * @returns {string} ISO 8601 timestamp, EXPIRY_DAYS in the future
 */
function calculateExpiresAt() {
  const expires = new Date();
  expires.setDate(expires.getDate() + EXPIRY_DAYS);
  return expires.toISOString();
}

/**
 * Check whether an invitation is expired based on its expires_at timestamp
 * @param {string} expiresAt - ISO 8601 timestamp
 * @returns {boolean}
 */
function isExpired(expiresAt) {
  return new Date(expiresAt) < new Date();
}

// ============================================================
// Public API
// ============================================================

/**
 * Create a new space invitation.
 *
 * - Generates a unique token and sets expiry to 7 days from now.
 * - If a pending invitation for the same email+space already exists
 *   and has not expired, returns the existing invitation.
 * - If the duplicate has expired, marks it as 'expired' and creates
 *   a fresh invitation.
 *
 * @param {number} spaceId - Target space ID
 * @param {number} invitedBy - User ID of the person sending the invitation
 * @param {string} invitedEmail - Email address of the invitee
 * @param {string} role - Role to grant upon acceptance ('owner'|'admin'|'editor'|'viewer')
 * @returns {Promise<object>} The invitation record (including token)
 * @throws {Error} If space not found or role is invalid
 */
export async function createInvitation(spaceId, invitedBy, invitedEmail, role = 'viewer') {
  // Validate inputs
  if (!spaceId) {
    throw new Error('spaceId is required');
  }
  if (!invitedBy) {
    throw new Error('invitedBy is required');
  }
  if (!invitedEmail || typeof invitedEmail !== 'string') {
    throw new Error('invitedEmail is required');
  }
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  // Verify space exists
  const space = await dbGet('SELECT id, name FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw new Error('Space not found');
  }

  // Normalise email to lowercase for consistent duplicate detection
  const normalizedEmail = invitedEmail.trim().toLowerCase();

  // Check for existing pending invitation for the same email + space
  const existing = await dbGet(
    `SELECT * FROM space_invitations
     WHERE space_id = ? AND invited_email = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [spaceId, normalizedEmail]
  );

  if (existing) {
    if (!isExpired(existing.expires_at)) {
      // Still valid - return the existing invitation
      apiLogger.info(
        { spaceId, email: normalizedEmail },
        'Returning existing pending invitation'
      );
      return existing;
    }

    // Expired - mark it and fall through to create a new one
    await dbRun(
      `UPDATE space_invitations SET status = 'expired' WHERE id = ?`,
      [existing.id]
    );
    apiLogger.info(
      { invitationId: existing.id },
      'Marked expired duplicate invitation'
    );
  }

  // Create new invitation
  const token = generateToken();
  const expiresAt = calculateExpiresAt();

  const result = await dbRun(
    `INSERT INTO space_invitations (space_id, invited_by, invited_email, role, token, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [spaceId, invitedBy, normalizedEmail, role, token, expiresAt]
  );

  const invitationId = result.lastInsertRowid || result.lastID;

  const invitation = await dbGet(
    'SELECT * FROM space_invitations WHERE id = ?',
    [invitationId]
  );

  apiLogger.info(
    { invitationId, spaceId, email: normalizedEmail, role },
    'Space invitation created'
  );

  // ADR-105 AC8: Send invitation email (non-blocking)
  const inviter = await dbGet('SELECT name FROM users WHERE id = ?', [invitedBy]);
  sendInvitationEmail(invitation, space.name, inviter?.name || 'A team member');

  return invitation;
}

/**
 * Accept a pending invitation by its token.
 *
 * - The invitation must be pending and not expired.
 * - The invitee must already have a registered account matching the email.
 * - On success, marks the invitation as 'accepted', records accepted_at,
 *   and creates a user_access_permissions entry for the space.
 *
 * @param {string} token - Invitation token
 * @returns {Promise<{success: boolean, invitation: object, space: object, user: object}>}
 * @throws {Error} If token invalid, expired, or user not registered
 */
export async function acceptInvitation(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required');
  }

  // Look up pending invitation by token
  const invitation = await dbGet(
    `SELECT * FROM space_invitations WHERE token = ? AND status = 'pending'`,
    [token]
  );

  if (!invitation) {
    throw new Error('Invitation not found or already used');
  }

  // Check expiry
  if (isExpired(invitation.expires_at)) {
    await dbRun(
      `UPDATE space_invitations SET status = 'expired' WHERE id = ?`,
      [invitation.id]
    );
    throw new Error('Invitation has expired');
  }

  // Find the user by their email - they must have registered first
  const user = await dbGet(
    'SELECT id, name, email FROM users WHERE LOWER(email) = ?',
    [invitation.invited_email.toLowerCase()]
  );

  if (!user) {
    throw new Error('User must register before accepting an invitation');
  }

  // Mark invitation as accepted
  await dbRun(
    `UPDATE space_invitations
     SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [invitation.id]
  );

  // Create user_access_permissions entry for this user in the space
  // Check if permission already exists (idempotent)
  const existingPerm = await dbGet(
    `SELECT id FROM user_access_permissions
     WHERE user_id = ? AND space_id = ?`,
    [user.id, invitation.space_id]
  );

  if (existingPerm) {
    // Update to the invitation role if it grants higher access
    const existingRow = await dbGet(
      'SELECT access_level FROM user_access_permissions WHERE id = ?',
      [existingPerm.id]
    );
    const existingValue = ACCESS_LEVEL_VALUES[existingRow.access_level] || 0;
    const newValue = ACCESS_LEVEL_VALUES[invitation.role] || 0;

    if (newValue > existingValue) {
      await dbRun(
        `UPDATE user_access_permissions
         SET access_level = ?, granted_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [invitation.role, invitation.invited_by, existingPerm.id]
      );
    }
  } else {
    await dbRun(
      `INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by)
       VALUES (?, ?, ?, ?)`,
      [user.id, invitation.space_id, invitation.role, invitation.invited_by]
    );
  }

  // Fetch space info for the response
  const space = await dbGet(
    'SELECT id, name, icon, type FROM spaces WHERE id = ?',
    [invitation.space_id]
  );

  apiLogger.info(
    { invitationId: invitation.id, userId: user.id, spaceId: invitation.space_id, role: invitation.role },
    'Invitation accepted'
  );

  return {
    success: true,
    invitation: await dbGet('SELECT * FROM space_invitations WHERE id = ?', [invitation.id]),
    space,
    user: { id: user.id, name: user.name, email: user.email }
  };
}

/**
 * Revoke a pending invitation.
 *
 * The revoker must have admin-level (or higher) access to the invitation's space.
 *
 * @param {number} invitationId - Invitation ID to revoke
 * @param {number} revokedBy - User ID performing the revocation
 * @returns {Promise<{success: boolean, message: string}>}
 * @throws {Error} If invitation not found, already processed, or insufficient permissions
 */
export async function revokeInvitation(invitationId, revokedBy) {
  if (!invitationId) {
    throw new Error('invitationId is required');
  }
  if (!revokedBy) {
    throw new Error('revokedBy is required');
  }

  // Get invitation
  const invitation = await dbGet(
    'SELECT * FROM space_invitations WHERE id = ?',
    [invitationId]
  );

  if (!invitation) {
    throw new Error('Invitation not found');
  }

  if (invitation.status !== 'pending') {
    throw new Error(`Cannot revoke invitation with status '${invitation.status}'`);
  }

  // Verify the revoker has admin+ access to the space
  const hasAccess = await verifyAdminAccess(invitation.space_id, revokedBy);
  if (!hasAccess) {
    throw new Error('Insufficient permissions: admin or higher access required');
  }

  // Update status to revoked
  await dbRun(
    `UPDATE space_invitations SET status = 'revoked' WHERE id = ?`,
    [invitationId]
  );

  apiLogger.info(
    { invitationId, revokedBy, spaceId: invitation.space_id },
    'Invitation revoked'
  );

  return { success: true, message: 'Invitation revoked' };
}

/**
 * List all invitations for a space, ordered by created_at descending.
 *
 * @param {number} spaceId - Space ID
 * @returns {Promise<Array<object>>} Array of invitation records
 */
export async function getInvitationsBySpace(spaceId) {
  if (!spaceId) {
    throw new Error('spaceId is required');
  }

  const invitations = await dbAll(
    `SELECT
       si.id,
       si.space_id,
       si.invited_by,
       si.invited_email,
       si.role,
       si.status,
       si.expires_at,
       si.created_at,
       si.accepted_at,
       u.name AS invited_by_name,
       u.email AS invited_by_email
     FROM space_invitations si
     LEFT JOIN users u ON si.invited_by = u.id
     WHERE si.space_id = ?
     ORDER BY si.created_at DESC`,
    [spaceId]
  );

  return invitations;
}

/**
 * Get a single invitation by its token (used for the acceptance page).
 *
 * Includes space name and inviter name so the UI can display context
 * without requiring authentication.
 *
 * @param {string} token - Invitation token
 * @returns {Promise<object|null>} Invitation with space/inviter info, or null
 */
export async function getInvitationByToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const invitation = await dbGet(
    `SELECT
       si.id,
       si.space_id,
       si.invited_by,
       si.invited_email,
       si.role,
       si.status,
       si.expires_at,
       si.created_at,
       si.accepted_at,
       s.name  AS space_name,
       s.icon  AS space_icon,
       s.type  AS space_type,
       u.name  AS inviter_name,
       u.email AS inviter_email
     FROM space_invitations si
     JOIN spaces s ON si.space_id = s.id
     LEFT JOIN users u ON si.invited_by = u.id
     WHERE si.token = ?`,
    [token]
  );

  return invitation || null;
}

/**
 * Batch-expire all pending invitations whose expires_at has passed.
 *
 * Intended to be called periodically (e.g. via a cron job or on-demand
 * cleanup endpoint).
 *
 * @returns {Promise<{expired: number}>} Count of newly expired invitations
 */
export async function expireOldInvitations() {
  const result = await dbRun(
    `UPDATE space_invitations
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP`
  );

  const expiredCount = result.changes || 0;

  if (expiredCount > 0) {
    apiLogger.info(
      { count: expiredCount },
      'Batch-expired old invitations'
    );
  }

  return { expired: expiredCount };
}

/**
 * Resend an invitation: generate a new token and reset expiry.
 *
 * The caller must have admin+ access to the space (enforced here).
 *
 * @param {number} invitationId - Invitation ID to resend
 * @param {number} resentBy - User ID performing the resend
 * @returns {Promise<object>} Updated invitation record
 * @throws {Error} If invitation not found, not pending, or insufficient permissions
 */
export async function resendInvitation(invitationId, resentBy) {
  if (!invitationId) {
    throw new Error('invitationId is required');
  }
  if (!resentBy) {
    throw new Error('resentBy is required');
  }

  // Get invitation
  const invitation = await dbGet(
    'SELECT * FROM space_invitations WHERE id = ?',
    [invitationId]
  );

  if (!invitation) {
    throw new Error('Invitation not found');
  }

  if (invitation.status !== 'pending') {
    throw new Error(`Cannot resend invitation with status '${invitation.status}'`);
  }

  // Verify caller has admin+ access
  const hasAccess = await verifyAdminAccess(invitation.space_id, resentBy);
  if (!hasAccess) {
    throw new Error('Insufficient permissions: admin or higher access required');
  }

  // Generate new token and reset expiry
  const newToken = generateToken();
  const newExpiresAt = calculateExpiresAt();

  await dbRun(
    `UPDATE space_invitations
     SET token = ?, expires_at = ?
     WHERE id = ?`,
    [newToken, newExpiresAt, invitationId]
  );

  const updated = await dbGet(
    'SELECT * FROM space_invitations WHERE id = ?',
    [invitationId]
  );

  apiLogger.info(
    { invitationId, resentBy, spaceId: invitation.space_id },
    'Invitation resent with new token'
  );

  // ADR-105 AC8: Re-send invitation email with new token (non-blocking)
  const space = await dbGet('SELECT name FROM spaces WHERE id = ?', [invitation.space_id]);
  const inviter = await dbGet('SELECT name FROM users WHERE id = ?', [resentBy]);
  sendInvitationEmail(
    { ...updated, token: newToken },
    space?.name || 'Unknown Space',
    inviter?.name || 'A team member'
  );

  return updated;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Send an invitation email to the invitee.
 *
 * Non-blocking — errors are logged but never thrown, so a failed email
 * does not prevent the invitation from being created/resent.
 *
 * @param {object} invitation - Invitation record (must include invited_email, token, role)
 * @param {string} spaceName - Space display name
 * @param {string} inviterName - Name of the person who sent the invitation
 */
async function sendInvitationEmail(invitation, spaceName, inviterName) {
  try {
    const baseUrl = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'https://devcrm.hltrn.cc';
    const acceptUrl = `${baseUrl}/invitations/${invitation.token}`;

    const subject = `You've been invited to "${spaceName}" on GOD CRM`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1e293b; margin-bottom: 8px;">You're invited!</h2>
        <p style="color: #475569; line-height: 1.6;">
          <strong>${inviterName || 'Someone'}</strong> has invited you to join the space
          <strong>"${spaceName}"</strong> as <strong>${invitation.role}</strong>.
        </p>
        <a href="${acceptUrl}"
           style="display: inline-block; margin: 24px 0; padding: 12px 28px; background: #0ea5e9; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Accept Invitation
        </a>
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">
          This invitation expires in 7 days.<br/>
          If you don't have an account yet, please register first using this email address:
          <strong>${invitation.invited_email}</strong>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;"/>
        <p style="color: #cbd5e1; font-size: 12px;">GOD CRM &mdash; Sent automatically, please do not reply.</p>
      </div>
    `;

    const result = await sendEmailWithFallback(invitation.invited_email, subject, html);
    if (result.success) {
      apiLogger.info(
        { email: invitation.invited_email, messageId: result.messageId },
        'Invitation email sent'
      );
    } else {
      apiLogger.warn(
        { email: invitation.invited_email, error: result.error },
        'Invitation email failed (non-critical)'
      );
    }
  } catch (err) {
    apiLogger.warn({ err, email: invitation.invited_email }, 'Invitation email send error (non-critical)');
  }
}

/**
 * Verify that a user has admin-level or higher access to a space.
 *
 * Checks:
 * 1. Space ownership (owner_id)
 * 2. Explicit user_access_permissions entry with admin/owner/owner_owner level
 *
 * @param {number} spaceId - Space ID
 * @param {number} userId - User ID to check
 * @returns {Promise<boolean>} true if user has admin+ access
 */
async function verifyAdminAccess(spaceId, userId) {
  // Check if user is the space owner
  const space = await dbGet(
    'SELECT owner_id FROM spaces WHERE id = ?',
    [spaceId]
  );

  if (!space) {
    return false;
  }

  if (space.owner_id === userId) {
    return true;
  }

  // Check user_access_permissions for admin+ level
  const permission = await dbGet(
    `SELECT access_level FROM user_access_permissions
     WHERE user_id = ? AND space_id = ?`,
    [userId, spaceId]
  );

  if (!permission) {
    return false;
  }

  const levelValue = ACCESS_LEVEL_VALUES[permission.access_level] || 0;
  const adminThreshold = ACCESS_LEVEL_VALUES['admin']; // 60

  return levelValue >= adminThreshold;
}
