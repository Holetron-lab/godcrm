/**
 * SpaceAccessManager - ADR-105 AC6
 *
 * This file is a thin re-export shim. The implementation was extracted
 * into `./space-access/` (AddUserPanel, GranularAccessDetails, UserRow,
 * constants, types, utils) to stay under the 800-line guard.
 *
 * All consumers should import from `./space-access` directly.
 */

export { SpaceAccessManager } from './space-access';
export type {
  SpaceAccessManagerProps,
  SystemUser,
  SpaceUserRow,
  TableColumn
} from './space-access';

import { SpaceAccessManager } from './space-access';
export default SpaceAccessManager;
