// wellness/profileVitalsController.js — Profile and vitals routes

import express from 'express';
import { dbAll, dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';
import {
  VALID_VITAL_TYPES,
  VALID_ACTIVITY_LEVELS,
  POINTS_CONFIG,
  calculateBMR,
  calculateTDEE,
  calculateAge,
  awardPoints,
  updateStreak,
} from './helpers.js';

const router = express.Router();

// =============================================================================
// PROFILE ROUTES
// =============================================================================

/**
 * GET /api/v3/wellness/profile
 * Get wellness profile for a space
 * @swagger
 * /api/v3/wellness/profile:
 *   get:
 *     summary: Get wellness profile for a space
 *     tags: [Wellness]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: space_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Wellness profile
 */
router.get('/profile', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    const profile = await dbGet('SELECT * FROM wellness_profiles WHERE space_id = ?', [space_id]);

    if (!profile) {
      return notFound(res, 'Wellness profile not found');
    }

    return success(res, profile);
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/profile error');
    return error(res, 'FETCH_PROFILE_ERROR', err.message, 500);
  }
});

/**
 * PUT /api/v3/wellness/profile
 * Create or update wellness profile
 * @swagger
 * /api/v3/wellness/profile:
 *   put:
 *     summary: Create or update wellness profile
 *     tags: [Wellness]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WellnessProfile'
 *     responses:
 *       200:
 *         description: Profile saved
 */
router.put('/profile', async (req, res) => {
  try {
    const { space_id, gender, birth_date, height_cm, target_weight_kg, activity_level, timezone } = req.body;

    // Validation
    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    if (height_cm !== undefined && (height_cm < 50 || height_cm > 300)) {
      return badRequest(res, 'height_cm must be between 50 and 300');
    }

    if (target_weight_kg !== undefined && (target_weight_kg < 20 || target_weight_kg > 500)) {
      return badRequest(res, 'target_weight_kg must be between 20 and 500');
    }

    if (activity_level !== undefined && !VALID_ACTIVITY_LEVELS.includes(activity_level)) {
      return badRequest(res, `activity_level must be one of: ${VALID_ACTIVITY_LEVELS.join(', ')}`);
    }

    // Check if profile exists
    const existing = await dbGet('SELECT * FROM wellness_profiles WHERE space_id = ?', [space_id]);

    // Get latest weight for BMR calculation
    const latestWeight = await dbGet(
      'SELECT value FROM wellness_vitals WHERE space_id = ? AND vital_type = ? ORDER BY measured_at DESC LIMIT 1',
      [space_id, 'weight']
    );
    const weightKg = latestWeight ? Number(latestWeight.value) : (target_weight_kg || null);

    // Calculate BMR and TDEE
    const age = calculateAge(birth_date || (existing ? existing.birth_date : null));
    const finalGender = gender || (existing ? existing.gender : 'male');
    const finalHeight = height_cm || (existing ? existing.height_cm : null);
    const finalActivity = activity_level || (existing ? existing.activity_level : 'moderate');

    const bmr = calculateBMR(finalGender, weightKg, finalHeight, age);
    const tdee = calculateTDEE(bmr, finalActivity);

    if (existing) {
      // Update existing profile
      await dbRun(`
        UPDATE wellness_profiles
        SET gender = COALESCE(?, gender),
            birth_date = COALESCE(?, birth_date),
            height_cm = COALESCE(?, height_cm),
            target_weight_kg = COALESCE(?, target_weight_kg),
            activity_level = COALESCE(?, activity_level),
            timezone = COALESCE(?, timezone),
            bmr = ?,
            tdee = ?,
            updated_at = ${sqlNow()}
        WHERE space_id = ?
      `, [gender, birth_date, height_cm, target_weight_kg, activity_level, timezone, bmr, tdee, space_id]);
    } else {
      // Create new profile
      await dbRun(`
        INSERT INTO wellness_profiles (space_id, gender, birth_date, height_cm, target_weight_kg, activity_level, timezone, bmr, tdee, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
      `, [space_id, gender || null, birth_date || null, height_cm || null, target_weight_kg || null, activity_level || 'moderate', timezone || 'UTC', bmr, tdee]);
    }

    const profile = await dbGet('SELECT * FROM wellness_profiles WHERE space_id = ?', [space_id]);

    apiLogger.info({ spaceId: space_id }, existing ? 'Wellness profile updated' : 'Wellness profile created');

    return success(res, profile);
  } catch (err) {
    apiLogger.error({ err }, 'PUT /wellness/profile error');
    return error(res, 'SAVE_PROFILE_ERROR', err.message, 500);
  }
});

// =============================================================================
// VITALS ROUTES
// =============================================================================

/**
 * POST /api/v3/wellness/vitals
 * Log a vital sign
 */
router.post('/vitals', async (req, res) => {
  try {
    const { space_id, vital_type, value, unit, source = 'manual', notes, measured_at } = req.body;

    // Validation
    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    if (!vital_type || !VALID_VITAL_TYPES.includes(vital_type)) {
      return badRequest(res, `vital_type must be one of: ${VALID_VITAL_TYPES.join(', ')}`);
    }

    if (value === undefined || value === null) {
      return badRequest(res, 'value is required');
    }

    const measuredAtValue = measured_at || new Date().toISOString();

    const result = await dbRun(`
      INSERT INTO wellness_vitals (space_id, vital_type, value, unit, source, notes, measured_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlNow()})
    `, [space_id, vital_type, value, unit || null, source, notes || null, measuredAtValue]);

    const vital = await dbGet('SELECT * FROM wellness_vitals WHERE id = ?', [result.lastInsertRowid]);

    // Award points
    await awardPoints(space_id, POINTS_CONFIG.log_vital, 'vital', vital.id, `Logged ${vital_type}`);

    // Update streak
    await updateStreak(space_id, 'vitals_logged', measuredAtValue);

    apiLogger.info({ vitalId: vital.id, spaceId: space_id, type: vital_type }, 'Vital logged');

    return created(res, vital);
  } catch (err) {
    apiLogger.error({ err }, 'POST /wellness/vitals error');
    return error(res, 'CREATE_VITAL_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/wellness/vitals
 * List vitals for a space
 */
router.get('/vitals', async (req, res) => {
  try {
    const { space_id, vital_type, from, to, limit = 100, offset = 0 } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    let sql = 'SELECT * FROM wellness_vitals WHERE space_id = ?';
    const params = [space_id];

    if (vital_type) {
      sql += ' AND vital_type = ?';
      params.push(vital_type);
    }

    if (from) {
      sql += ' AND measured_at >= ?';
      params.push(from);
    }

    if (to) {
      sql += ' AND measured_at <= ?';
      params.push(to + 'T23:59:59Z');
    }

    sql += ' ORDER BY measured_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const vitals = await dbAll(sql, params);

    return success(res, vitals || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/vitals error');
    return error(res, 'FETCH_VITALS_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/wellness/vitals/latest
 * Get latest value for each vital type
 */
router.get('/vitals/latest', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    const result = {};

    for (const vitalType of VALID_VITAL_TYPES) {
      const latest = await dbGet(
        'SELECT * FROM wellness_vitals WHERE space_id = ? AND vital_type = ? ORDER BY measured_at DESC LIMIT 1',
        [space_id, vitalType]
      );
      if (latest) {
        result[vitalType] = latest;
      }
    }

    return success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/vitals/latest error');
    return error(res, 'FETCH_LATEST_VITALS_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/wellness/vitals/trends
 * Get trend analysis for a vital type
 */
router.get('/vitals/trends', async (req, res) => {
  try {
    const { space_id, vital_type, days = 30 } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    if (!vital_type) {
      return badRequest(res, 'vital_type is required');
    }

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - parseInt(days));

    const vitals = await dbAll(
      'SELECT * FROM wellness_vitals WHERE space_id = ? AND vital_type = ? AND measured_at >= ? ORDER BY measured_at ASC',
      [space_id, vital_type, fromDate.toISOString()]
    );

    if (!vitals || vitals.length < 2) {
      return success(res, {
        trend: 'insufficient_data',
        data_points: vitals?.length || 0
      });
    }

    // Calculate trend
    const firstValue = Number(vitals[0].value);
    const lastValue = Number(vitals[vitals.length - 1].value);
    const change = lastValue - firstValue;
    const changePct = (change / firstValue) * 100;

    let trend;
    if (Math.abs(changePct) < 1) {
      trend = 'stable';
    } else if (change > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Calculate average and min/max
    const values = vitals.map(v => Number(v.value));
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return success(res, {
      trend,
      change: Math.round(change * 100) / 100,
      change_pct: Math.round(changePct * 100) / 100,
      data_points: vitals.length,
      first_value: firstValue,
      last_value: lastValue,
      average: Math.round(avg * 100) / 100,
      min,
      max,
      period_days: parseInt(days)
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/vitals/trends error');
    return error(res, 'FETCH_VITALS_TRENDS_ERROR', err.message, 500);
  }
});

export default router;
