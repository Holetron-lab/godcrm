/**
 * @swagger
 * components:
 *   schemas:
 *     Workout:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         space_id:
 *           type: integer
 *         title:
 *           type: string
 *         started_at:
 *           type: string
 *           format: date-time
 *         ended_at:
 *           type: string
 *           format: date-time
 *     WorkoutSet:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         workout_id:
 *           type: integer
 *         exercise_name:
 *           type: string
 *         reps:
 *           type: integer
 *         weight:
 *           type: number
 */

// API v3: Fitness Routes — thin router that imports all controllers

import express from 'express';
import workoutController from './workoutController.js';
import setExerciseController from './setExerciseController.js';
import analyticsController from './analyticsController.js';

const router = express.Router();

// 1. Workouts CRUD
router.use(workoutController);

// 2. Sets CRUD + exercises catalog + CSV import
router.use(setExerciseController);

// 3. Analytics endpoints
router.use(analyticsController);

export default router;
