/**
 * space/index.js — Barrel re-export for SpaceService modules
 *
 * All public exports from the original SpaceService.js are re-exported here.
 */

export { createSpace, getSpacesByUser, getSpaceById, updateSpace, deleteSpace } from './crud.js';
export {
  checkUserSpaceAccess,
  checkUserAccessViaTableV2,
  getUserAccessData,
  canAccessColumn,
  canAccessProject,
  canAccessTable,
  getEffectiveProjectRole,
  canAccessSystemDataProject,
  canAccessSpace
} from './access.js';
export { getSpaceVariables, recalculateSpaceVariables } from './variables.js';
