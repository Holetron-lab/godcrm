// columns/helpers.js — Shared middleware for column routes

import { dbGet } from '../../../database/connection.js';
import { notFound, forbidden } from '../../../utils/response.js';

/**
 * Middleware: Verify table exists and user has access
 */
export const verifyTableAccess = async (req, res, next) => {
  const { tableId } = req.params;
  const userId = req.user?.id;

  const table = await dbGet(`
    SELECT
      ut.id,
      ut.project_id,
      ut.is_system,
      ut.sync_target,
      p.owner_id,
      p.space_id
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE ut.id = ?
  `, [tableId]);

  if (!table) {
    return notFound(res, 'Table');
  }

  const isProjectOwner = table.owner_id === userId;
  const isSysAdmin = req.user?.role === 'admin' || req.user?.role === 'owner';

  if (!isProjectOwner && !isSysAdmin) {
    if (table.space_id) {
      try {
        const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [table.space_id]);
        if (space && space.owner_id === userId) {
          req.table = table;
          return next();
        }
      } catch (e) {
        // Ignore space lookup errors
      }
    }
    return forbidden(res, 'You do not have access to this table');
  }

  req.table = table;
  next();
};
