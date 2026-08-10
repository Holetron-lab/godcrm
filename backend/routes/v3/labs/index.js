/**
 * Labs Routes Index
 * Mounts all sub-routers for the labs feature
 * @see ADR-043: Laboratories Feature
 * @see ADR-119: Monster file refactoring
 *
 * IMPORTANT: Mount order matters - specific paths before parameterized ones.
 * Routes with /node-types, /metrics, /ai/* must come before /:id, /:labTableId
 */
import { Router } from 'express';

import nodeTypesRouter from './node-types.js';
import aiRouter from './ai.js';
import projectsRouter from './projects.js';
import nodesRouter from './nodes.js';
import executionRouter from './execution.js';
import executionOpsRouter from './execution-ops.js';
import legacyRouter from './legacy.js';
import edgesRouter from './edges.js';
import metricsRouter from './metrics.js';

const router = Router();

// 1. Specific-path routes first (no param conflicts)
router.use(nodeTypesRouter);    // GET /node-types
router.use(aiRouter);           // /ai/agents, /ai/providers, /ai/templates/*

// 2. Projects v4 (/projects/*)
router.use(projectsRouter);

// 3. Nodes v4 CRUD (/:labTableId/nodes/*)
router.use(nodesRouter);

// 4. Execution (/:labTableId/nodes/:nodeId/execute|run|rerun|split)
router.use(executionRouter);
router.use(executionOpsRouter);

// 5. Legacy routes (/, /:id, /init, legacy /projects/*, legacy nodes)
router.use(legacyRouter);

// 6. Edges (/:id/edges, /edges/:edgeId, /projects/:id/edges)
router.use(edgesRouter);

// 7. Metrics (/metrics, /:labId/metrics, /nodes/:nodeId/metrics)
router.use(metricsRouter);

export default router;
