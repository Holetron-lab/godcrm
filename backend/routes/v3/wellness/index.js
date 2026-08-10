/**
 * @swagger
 * components:
 *   schemas:
 *     WellnessProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         space_id:
 *           type: integer
 *         birth_date:
 *           type: string
 *           format: date
 *         gender:
 *           type: string
 *           enum: [male, female, other]
 *         height_cm:
 *           type: number
 *         activity_level:
 *           type: string
 *     VitalRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         profile_id:
 *           type: integer
 *         vital_type:
 *           type: string
 *         value:
 *           type: number
 *         recorded_at:
 *           type: string
 *           format: date-time
 */

// API v3: Wellness Routes — thin router that imports all controllers

import express from 'express';
import profileVitalsController from './profileVitalsController.js';
import gamificationController from './gamificationController.js';

const router = express.Router();

// 1. Profile + vitals
router.use(profileVitalsController);

// 2. Gamification, streaks, dashboard
router.use(gamificationController);

export default router;
