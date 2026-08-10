/**
 * @swagger
 * tags:
 *   - name: Tables
 *     description: Universal tables management
 */

// API v3: Tables Routes — thin router that imports all controllers
import express from 'express';
import tableCreateController from './tableCreateController.js';
import tableManageController from './tableManageController.js';
import tableColumnController from './tableColumnController.js';
import tableRowListController from './tableRowListController.js';
import tableRowGetController from './tableRowGetController.js';
import tableRowCreateController from './tableRowCreateController.js';
import tableRowMutateController from './tableRowMutateController.js';
import tableRowBatchController from './tableRowBatchController.js';
import tableSummaryVariableController from './tableSummaryVariableController.js';
import verificationController from './verificationController.js'; // ADR-0011 Phase A

const router = express.Router();

// Mount order matters for Express route matching:
// 1. Table creation (includes /tables/create-calendar before :tableId,
//    GET /tables/:tableId, POST /tables, GET /users)
router.use(tableCreateController);

// 2. Table list/manage (GET /tables, GET /projects/:projectId/tables,
//    POST /tables/:tableId/connect, PATCH/DELETE /tables/:tableId)
router.use(tableManageController);

// 3. Column operations: GET /tables/:tableId/columns
router.use(tableColumnController);

// 4. Row batch operations must come before single-row routes
//    to avoid :rowId matching "batch-update" or "batch-delete"
router.use(tableRowBatchController);

// 5. Row list: GET /tables/:tableId/rows
router.use(tableRowListController);

// 6. Single row getters: GET /tables/:tableId/rows/base/:baseId (before :rowId),
//    GET /tables/:tableId/rows/:rowId
router.use(tableRowGetController);

// 7. Row create: POST /tables/:tableId/rows
router.use(tableRowCreateController);

// 8. Row update/delete: PUT/DELETE /tables/:tableId/rows/:rowId
router.use(tableRowMutateController);

// 9. Summary variable: POST /tables/:tableId/columns/:columnId/summary-variable
router.use(tableSummaryVariableController);

// 10. ADR-0011 verification: POST /tables/:tableId/rows/:rowId/columns/:columnId/verify|unverify
router.use(verificationController);

export default router;
