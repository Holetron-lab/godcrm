/**
 * SpaceService.js — Manages Spaces (Business/Personal/Admin)
 *
 * Split into modules under ./space/. This file re-exports everything
 * for backward compatibility.
 */

export {
  createSpace,
  getSpacesByUser,
  getSpaceById,
  updateSpace,
  deleteSpace,
  checkUserSpaceAccess,
  checkUserAccessViaTableV2,
  getUserAccessData,
  canAccessColumn,
  canAccessProject,
  canAccessTable,
  getEffectiveProjectRole,
  canAccessSystemDataProject,
  canAccessSpace,
  getSpaceVariables,
  recalculateSpaceVariables
} from './space/index.js';
