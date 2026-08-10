/**
 * @swagger
 * components:
 *   schemas:
 *     Column:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         table_id:
 *           type: integer
 *         name:
 *           type: string
 *         display_name:
 *           type: string
 *         column_type:
 *           type: string
 *           enum: [text, number, date, boolean, select, multiselect, file, image, url, email, phone, relation, formula, rollup, lookup]
 *         config:
 *           type: object
 *         is_required:
 *           type: boolean
 *         is_visible:
 *           type: boolean
 *         is_readonly:
 *           type: boolean
 *         order_index:
 *           type: integer
 *         width:
 *           type: integer
 */

// API v3: Columns Routes — thin router that imports all controllers

import express from 'express';
import columnCrudController from './columnCrudController.js';
import columnOpsController from './columnOpsController.js';

const router = express.Router();

// 1. Column CRUD (list, create, get, update, delete)
router.use(columnCrudController);

// 2. Column operations (reorder, convert-to-iso)
router.use(columnOpsController);

export default router;
