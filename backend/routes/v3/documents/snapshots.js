// ADR-0016 Phase 1 §4: GET /api/v3/documents/snapshot
//
// Authenticated read endpoint for the document snapshot FS layer
// (`docs/.snapshots/<widget-slug>/<doc-slug>/<timestamp>.md` — see
// CLAUDE.md "Document snapshots" section). Replaces the previous "agents
// can only read these off the filesystem" hole.
//
// - JWT required (mounted under the authenticated `documents` router).
// - Path-traversal protected: the resolved absolute path MUST start with
//   SNAPSHOTS_BASE, otherwise 400.
// - Content-Type: text/markdown; charset=utf-8.

import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { apiLogger } from '../../../utils/logger.js';
import { badRequest, notFound, error } from '../../../utils/response.js';

const router = express.Router();

// Trailing separator is important — `startsWith(BASE)` without the sep
// would let `/foo/.snapshots-evil/...` slip past.
const SNAPSHOTS_BASE = path.resolve('/root/production/business-crm/docs/.snapshots') + path.sep;

router.get('/documents/snapshot', async (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel || typeof rel !== 'string') {
      return badRequest(res, '`path` query parameter is required', 'MISSING_PATH');
    }

    // path.resolve normalizes any `..` segments BEFORE the prefix check —
    // a traversal like `?path=../../etc/passwd` resolves outside
    // SNAPSHOTS_BASE and is rejected.
    const abs = path.resolve(SNAPSHOTS_BASE, rel);

    if (!abs.startsWith(SNAPSHOTS_BASE)) {
      apiLogger.warn(
        { rel, abs, base: SNAPSHOTS_BASE, user: req.user?.id },
        '[snapshots] path traversal rejected'
      );
      return badRequest(res, 'Path escapes snapshots directory', 'PATH_TRAVERSAL');
    }

    let content;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        return notFound(res, 'Snapshot');
      }
      throw err;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.send(content);
  } catch (err) {
    apiLogger.error({ err }, 'GET /documents/snapshot error');
    return error(res, 'SNAPSHOT_READ_ERROR', err.message, 500);
  }
});

export default router;
export { SNAPSHOTS_BASE };
