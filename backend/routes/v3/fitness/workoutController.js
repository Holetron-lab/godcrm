/**
 * fitness/workoutController.js — Workouts CRUD
 */

import express from 'express';
import { dbAll, dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';

const router = express.Router();

// =============================================================================
// WORKOUTS CRUD
// =============================================================================

/**
 * POST /api/v3/fitness/workouts
 * Create a new workout session
 * @swagger
 * /api/v3/fitness/workouts:
 *   post:
 *     summary: Create a new workout session
 *     tags: [Fitness]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Workout'
 *     responses:
 *       201:
 *         description: Workout created
 */
router.post('/workouts', async (req, res) => {
  try {
    const { space_id, title, description, started_at, ended_at, notes, source = 'manual' } = req.body;

    // Validation
    if (!space_id) {
      return badRequest(res, 'space_id is required', 'VALIDATION_ERROR');
    }

    if (!started_at) {
      return badRequest(res, 'started_at is required', 'VALIDATION_ERROR');
    }

    const result = await dbRun(`
      INSERT INTO fitness_workouts (space_id, title, description, started_at, ended_at, notes, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [space_id, title || null, description || null, started_at, ended_at || null, notes || null, source]);

    const workout = await dbGet('SELECT * FROM fitness_workouts WHERE id = ?', [result.lastInsertRowid]);

    apiLogger.info({ workoutId: workout.id, spaceId: space_id }, 'Workout created');

    return created(res, workout);
  } catch (err) {
    apiLogger.error({ err }, 'POST /fitness/workouts error');
    return error(res, 'CREATE_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/workouts
 * List workouts for a space
 * @swagger
 * /api/v3/fitness/workouts:
 *   get:
 *     summary: List workouts for a space
 *     tags: [Fitness]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: space_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of workouts
 */
router.get('/workouts', async (req, res) => {
  try {
    const { space_id, limit = 50, offset = 0 } = req.query;

    let sql = 'SELECT * FROM fitness_workouts';
    const params = [];

    if (space_id) {
      sql += ' WHERE space_id = ?';
      params.push(space_id);
    }

    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const workouts = await dbAll(sql, params);

    return success(res, workouts || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/workouts error');
    return error(res, 'FETCH_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/workouts/:id
 * Get single workout with its sets
 */
router.get('/workouts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const workout = await dbGet('SELECT * FROM fitness_workouts WHERE id = ?', [id]);

    if (!workout) {
      return notFound(res, 'Workout not found');
    }

    // Get sets for this workout
    const sets = await dbAll(
      'SELECT * FROM fitness_sets WHERE workout_id = ? ORDER BY set_index',
      [id]
    );

    return success(res, { ...workout, sets: sets || [] });
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/workouts/:id error');
    return error(res, 'FETCH_FAILED', err.message, 500);
  }
});

/**
 * PUT /api/v3/fitness/workouts/:id
 * Update a workout
 */
router.put('/workouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, started_at, ended_at, notes } = req.body;

    // Check workout exists
    const existing = await dbGet('SELECT * FROM fitness_workouts WHERE id = ?', [id]);
    if (!existing) {
      return notFound(res, 'Workout not found');
    }

    await dbRun(`
      UPDATE fitness_workouts
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          started_at = COALESCE(?, started_at),
          ended_at = COALESCE(?, ended_at),
          notes = COALESCE(?, notes),
          updated_at = ${sqlNow()}
      WHERE id = ?
    `, [title, description, started_at, ended_at, notes, id]);

    const updated = await dbGet('SELECT * FROM fitness_workouts WHERE id = ?', [id]);

    apiLogger.info({ workoutId: id }, 'Workout updated');

    return success(res, updated);
  } catch (err) {
    apiLogger.error({ err }, 'PUT /fitness/workouts/:id error');
    return error(res, 'UPDATE_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/fitness/workouts/:id
 * Delete a workout (cascades to sets)
 */
router.delete('/workouts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check workout exists
    const existing = await dbGet('SELECT * FROM fitness_workouts WHERE id = ?', [id]);
    if (!existing) {
      return notFound(res, 'Workout not found');
    }

    await dbRun('DELETE FROM fitness_workouts WHERE id = ?', [id]);

    apiLogger.info({ workoutId: id }, 'Workout deleted');

    return success(res, { deleted: true, id: parseInt(id) });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /fitness/workouts/:id error');
    return error(res, 'DELETE_FAILED', err.message, 500);
  }
});

export default router;
