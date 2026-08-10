/**
 * fitness/setExerciseController.js — Sets CRUD, exercises catalog, CSV import
 */

import express from 'express';
import { dbAll, dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';

const router = express.Router();

// =============================================================================
// SETS CRUD
// =============================================================================

/**
 * POST /api/v3/fitness/workouts/:workoutId/sets
 * Add a set to a workout
 */
router.post('/workouts/:workoutId/sets', async (req, res) => {
  try {
    const { workoutId } = req.params;
    const {
      exercise_id, exercise_name, set_index, set_type = 'normal',
      weight_kg, reps, rpe, distance_km, duration_seconds, notes, is_pr = false
    } = req.body;

    // Validation
    if (!exercise_name && !exercise_id) {
      return badRequest(res, 'exercise_name or exercise_id is required', 'VALIDATION_ERROR');
    }

    // Check workout exists
    const workout = await dbGet('SELECT id FROM fitness_workouts WHERE id = ?', [workoutId]);
    if (!workout) {
      return notFound(res, 'Workout not found');
    }

    const result = await dbRun(`
      INSERT INTO fitness_sets (
        workout_id, exercise_id, exercise_name, set_index, set_type,
        weight_kg, reps, rpe, distance_km, duration_seconds, notes, is_pr, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()})
    `, [
      workoutId, exercise_id || null, exercise_name, set_index || 1, set_type,
      weight_kg || null, reps || null, rpe || null, distance_km || null,
      duration_seconds || null, notes || null, is_pr ? true : false
    ]);

    const set = await dbGet('SELECT * FROM fitness_sets WHERE id = ?', [result.lastInsertRowid]);

    apiLogger.info({ setId: set.id, workoutId }, 'Set created');

    return created(res, set);
  } catch (err) {
    apiLogger.error({ err }, 'POST /fitness/workouts/:workoutId/sets error');
    return error(res, 'CREATE_FAILED', err.message, 500);
  }
});

/**
 * PUT /api/v3/fitness/sets/:id
 * Update a set
 */
router.put('/sets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      exercise_name, set_index, set_type, weight_kg, reps,
      rpe, distance_km, duration_seconds, notes, is_pr
    } = req.body;

    // Check set exists
    const existing = await dbGet('SELECT * FROM fitness_sets WHERE id = ?', [id]);
    if (!existing) {
      return notFound(res, 'Set not found');
    }

    await dbRun(`
      UPDATE fitness_sets
      SET exercise_name = COALESCE(?, exercise_name),
          set_index = COALESCE(?, set_index),
          set_type = COALESCE(?, set_type),
          weight_kg = COALESCE(?, weight_kg),
          reps = COALESCE(?, reps),
          rpe = COALESCE(?, rpe),
          distance_km = COALESCE(?, distance_km),
          duration_seconds = COALESCE(?, duration_seconds),
          notes = COALESCE(?, notes),
          is_pr = COALESCE(?, is_pr)
      WHERE id = ?
    `, [exercise_name, set_index, set_type, weight_kg, reps, rpe, distance_km, duration_seconds, notes, is_pr !== undefined ? (is_pr ? true : false) : null, id]);

    const updated = await dbGet('SELECT * FROM fitness_sets WHERE id = ?', [id]);

    apiLogger.info({ setId: id }, 'Set updated');

    return success(res, updated);
  } catch (err) {
    apiLogger.error({ err }, 'PUT /fitness/sets/:id error');
    return error(res, 'UPDATE_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/fitness/sets/:id
 * Delete a set
 */
router.delete('/sets/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check set exists
    const existing = await dbGet('SELECT * FROM fitness_sets WHERE id = ?', [id]);
    if (!existing) {
      return notFound(res, 'Set not found');
    }

    await dbRun('DELETE FROM fitness_sets WHERE id = ?', [id]);

    apiLogger.info({ setId: id }, 'Set deleted');

    return success(res, { deleted: true, id: parseInt(id) });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /fitness/sets/:id error');
    return error(res, 'DELETE_FAILED', err.message, 500);
  }
});

// =============================================================================
// EXERCISES CATALOG
// =============================================================================

/**
 * GET /api/v3/fitness/exercises
 * List exercises (global + user-specific)
 */
router.get('/exercises', async (req, res) => {
  try {
    const { space_id, search, muscle, equipment, limit = 100 } = req.query;

    let sql = 'SELECT * FROM fitness_exercises WHERE 1=1';
    const params = [];

    // Include global exercises (space_id IS NULL) and user's custom exercises
    if (space_id) {
      sql += ' AND (space_id IS NULL OR space_id = ?)';
      params.push(space_id);
    }

    if (search) {
      sql += ' AND name ILIKE ?';
      params.push(`%${search}%`);
    }

    if (muscle) {
      sql += ' AND (primary_muscle = ? OR secondary_muscle = ?)';
      params.push(muscle, muscle);
    }

    if (equipment) {
      sql += ' AND equipment = ?';
      params.push(equipment);
    }

    sql += ' ORDER BY name LIMIT ?';
    params.push(parseInt(limit));

    const exercises = await dbAll(sql, params);

    return success(res, exercises || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/exercises error');
    return error(res, 'FETCH_FAILED', err.message, 500);
  }
});

/**
 * POST /api/v3/fitness/exercises
 * Create a custom exercise
 */
router.post('/exercises', async (req, res) => {
  try {
    const { space_id, name, equipment, primary_muscle, secondary_muscle, category } = req.body;

    if (!name) {
      return badRequest(res, 'name is required', 'VALIDATION_ERROR');
    }

    const result = await dbRun(`
      INSERT INTO fitness_exercises (space_id, name, equipment, primary_muscle, secondary_muscle, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()})
    `, [space_id || null, name, equipment || null, primary_muscle || null, secondary_muscle || null, category || null]);

    const exercise = await dbGet('SELECT * FROM fitness_exercises WHERE id = ?', [result.lastInsertRowid]);

    apiLogger.info({ exerciseId: exercise.id, name }, 'Exercise created');

    return created(res, exercise);
  } catch (err) {
    apiLogger.error({ err }, 'POST /fitness/exercises error');
    return error(res, 'CREATE_FAILED', err.message, 500);
  }
});

// =============================================================================
// CSV IMPORT
// =============================================================================

const LBS_TO_KG = 0.45359237;

/**
 * Parse CSV string into rows
 */
function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Detect CSV format based on headers
 */
function detectFormat(headers) {
  const headerSet = new Set(headers);

  // Hevy format: title, start_time, exercise_title, weight_kg
  if (headerSet.has('exercise_title') && headerSet.has('start_time')) {
    return 'hevy';
  }

  // Strong format: Date, Workout Name, Exercise Name, Weight, Weight Unit
  if (headerSet.has('workout_name') || headerSet.has('exercise_name')) {
    return 'strong';
  }

  // Fallback to generic
  return 'generic';
}

/**
 * Map row to normalized workout/set data based on format
 */
function normalizeRow(row, format) {
  if (format === 'hevy') {
    return {
      workout_title: row.title || 'Imported Workout',
      started_at: row.start_time,
      ended_at: row.end_time || null,
      description: row.description || null,
      exercise_name: row.exercise_title,
      set_type: row.set_type || 'normal',
      weight_kg: parseFloat(row.weight_kg) || null,
      reps: parseInt(row.reps) || null,
      rpe: parseFloat(row.rpe) || null,
      distance_km: parseFloat(row.distance_km) || null,
      duration_seconds: parseInt(row.duration_seconds) || null,
      notes: row.notes || null
    };
  }

  if (format === 'strong') {
    let weight = parseFloat(row.weight) || null;
    const weightUnit = (row.weight_unit || 'kg').toLowerCase();
    if (weight && weightUnit === 'lbs') {
      weight = weight * LBS_TO_KG;
    }

    return {
      workout_title: row.workout_name || 'Imported Workout',
      started_at: row.date,
      ended_at: null,
      description: row.workout_notes || null,
      exercise_name: row.exercise_name,
      set_type: 'normal',
      set_index: parseInt(row.set_order) || 1,
      weight_kg: weight,
      reps: parseInt(row.reps) || null,
      rpe: parseFloat(row.rpe) || null,
      distance_km: parseFloat(row.distance) || null,
      duration_seconds: parseInt(row.seconds) || null,
      notes: row.notes || null
    };
  }

  // Generic format - try common field names
  let weight = parseFloat(row.weight_kg || row.weight) || null;
  const weightUnit = (row.weight_unit || 'kg').toLowerCase();
  if (weight && weightUnit === 'lbs') {
    weight = weight * LBS_TO_KG;
  }

  return {
    workout_title: row.title || row.workout_title || row.workout_name || 'Imported Workout',
    started_at: row.start_time || row.date || row.started_at,
    ended_at: row.end_time || row.ended_at || null,
    description: row.description || null,
    exercise_name: row.exercise_title || row.exercise_name || row.exercise,
    set_type: row.set_type || 'normal',
    weight_kg: weight,
    reps: parseInt(row.reps) || null,
    rpe: parseFloat(row.rpe) || null,
    distance_km: parseFloat(row.distance_km || row.distance) || null,
    duration_seconds: parseInt(row.duration_seconds || row.seconds) || null,
    notes: row.notes || null
  };
}

/**
 * POST /api/v3/fitness/import/csv
 * Import workouts from CSV file
 */
router.post('/import/csv', async (req, res) => {
  try {
    const { space_id, format: requestedFormat } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required', 'VALIDATION_ERROR');
    }

    const csvData = typeof req.body === 'string' ? req.body : '';

    if (!csvData.trim()) {
      return badRequest(res, 'CSV data is empty', 'EMPTY_CSV');
    }

    const { headers, rows } = parseCSV(csvData);
    const format = requestedFormat || detectFormat(headers);

    // Group rows by workout (by title + started_at)
    const workoutGroups = new Map();
    let rowsSkipped = 0;

    for (const row of rows) {
      const normalized = normalizeRow(row, format);

      // Skip rows without exercise name
      if (!normalized.exercise_name) {
        rowsSkipped++;
        continue;
      }

      const workoutKey = `${normalized.workout_title}|${normalized.started_at}`;

      if (!workoutGroups.has(workoutKey)) {
        workoutGroups.set(workoutKey, {
          title: normalized.workout_title,
          started_at: normalized.started_at,
          ended_at: normalized.ended_at,
          description: normalized.description,
          sets: []
        });
      }

      workoutGroups.get(workoutKey).sets.push({
        exercise_name: normalized.exercise_name,
        set_type: normalized.set_type,
        set_index: normalized.set_index || workoutGroups.get(workoutKey).sets.length + 1,
        weight_kg: normalized.weight_kg,
        reps: normalized.reps,
        rpe: normalized.rpe,
        distance_km: normalized.distance_km,
        duration_seconds: normalized.duration_seconds,
        notes: normalized.notes
      });
    }

    // Insert workouts and sets
    let workoutsCreated = 0;
    let setsCreated = 0;

    for (const [, workout] of workoutGroups) {
      // Create workout
      const workoutResult = await dbRun(`
        INSERT INTO fitness_workouts (space_id, title, description, started_at, ended_at, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
      `, [space_id, workout.title, workout.description, workout.started_at, workout.ended_at, `csv_${format}`]);

      const workoutId = workoutResult.lastInsertRowid;
      workoutsCreated++;

      // Create sets
      for (const set of workout.sets) {
        await dbRun(`
          INSERT INTO fitness_sets (workout_id, exercise_name, set_index, set_type, weight_kg, reps, rpe, distance_km, duration_seconds, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()})
        `, [workoutId, set.exercise_name, set.set_index, set.set_type, set.weight_kg, set.reps, set.rpe, set.distance_km, set.duration_seconds, set.notes]);
        setsCreated++;
      }
    }

    apiLogger.info({ spaceId: space_id, workoutsCreated, setsCreated, format }, 'CSV import completed');

    return success(res, {
      format_detected: format,
      workouts_created: workoutsCreated,
      sets_created: setsCreated,
      rows_skipped: rowsSkipped
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /fitness/import/csv error');
    return error(res, 'IMPORT_FAILED', err.message, 500);
  }
});

export default router;
