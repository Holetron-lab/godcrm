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
