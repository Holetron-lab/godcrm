// API v3: Documents Routes - Thin router that imports all sub-routers
/**
 * @swagger
 * components:
 *   schemas:
 *     Document:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         project_id:
 *           type: integer
 *         title:
 *           type: string
 *         key:
 *           type: string
 *         description:
 *           type: string
 *         structure:
 *           type: object
 *     DocumentAtom:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         document_id:
 *           type: integer
 *         level:
 *           type: string
 *           enum: [h2, h3, content]
 *         title:
 *           type: string
 *         content:
 *           type: string
 */
import express from 'express';

import crudRouter from './crud.js';
import contentRouter from './content.js';
import languagesRouter from './languages.js';
import legacyRouter from './legacy.js';
import structureRouter from './structure.js';
import tasksRouter from './tasks.js';
import researchRouter from './research.js';
import snapshotsRouter from './snapshots.js';

const router = express.Router();

// Folder init, list, create, delete documents
router.use(crudRouter);

// Content retrieval, v4 import
router.use(contentRouter);

// Language management and migration
router.use(languagesRouter);

// Legacy v3 import/export (backward compatibility)
router.use(legacyRouter);

// Structure management, column setup
router.use(structureRouter);

// ADR-038: Task binding endpoints
router.use(tasksRouter);

// ADR-0003 Phase 0 (C-6): express research log
router.use(researchRouter);

// ADR-0016 Phase 1: Authenticated snapshot read endpoint
router.use(snapshotsRouter);

export default router;
