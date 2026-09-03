// system/helpers.js — Shared middleware for system routes

import { forbidden } from '../../../utils/response.js';

/**
 * Middleware to check if user is owner
 */
export const ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return forbidden(res, 'Only owner can access system settings');
  }
  next();
};

/**
 * Middleware to check if user is owner or admin
 */
export const adminOrOwner = (req, res, next) => {
  if (req.user?.role !== 'owner' && req.user?.role !== 'admin') {
    return forbidden(res, 'Only admin or owner can access this');
  }
  next();
};

/**
 * Boolean owner-role gate for inline (non-middleware) call sites.
 *
 * Returns true when the caller holds role='owner'; otherwise writes a 403
 * onto `res` and returns false — the `if (!requireOwnerRole(req, res)) return;`
 * shape used by the admin / audit / owner / agent-permissions routes.
 *
 * This is the portable replacement for the `spaces WHERE id = 11` +
 * `owner_id === req.user.id` gate those routes carried (ADR-188 / ADR-189):
 * there is no hardcoded space to be missing, so it no longer 500s
 * `OWNER_SPACE_MISSING` on a from-empty community box (box 205 / devcrm).
 *
 * NOTE (ADR-189): this gates on the JWT `role` claim, admitting ANY
 * role='owner' principal — on master A that is >1 user, a deliberate,
 * reviewed widening. The `_secrets` vault (secrets.js) stays identity-based
 * and is intentionally NOT converged onto this helper.
 */
export const requireOwnerRole = (req, res) => {
  if (req.user?.role !== 'owner') {
    forbidden(res, 'Owner-only endpoint');
    return false;
  }
  return true;
};
