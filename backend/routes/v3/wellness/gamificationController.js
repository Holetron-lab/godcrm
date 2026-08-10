// wellness/gamificationController.js — Gamification, streaks, dashboard

import express from 'express';
import { dbAll, dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { VALID_VITAL_TYPES, xpForLevel } from './helpers.js';

const router = express.Router();

// =============================================================================
// GAMIFICATION ROUTES
// =============================================================================

/**
 * GET /api/v3/wellness/gamification/summary
 * Get user's gamification summary (level, XP, etc.)
 */
router.get('/gamification/summary', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    // Get or create level entry
    let level = await dbGet('SELECT * FROM wellness_levels WHERE space_id = ?', [space_id]);

    if (!level) {
      await dbRun(`
        INSERT INTO wellness_levels (space_id, current_level, total_xp, level_xp, title, updated_at)
        VALUES (?, 1, 0, 0, 'Beginner', ${sqlNow()})
      `, [space_id]);
      level = await dbGet('SELECT * FROM wellness_levels WHERE space_id = ?', [space_id]);
    }

    // Calculate XP needed for next level
    const xpForNextLevel = xpForLevel(level.current_level + 1);
    const progressPct = Math.round((level.level_xp / xpForNextLevel) * 100);

    // Get total points earned today
    const today = new Date().toISOString().split('T')[0];
    const todayPoints = await dbGet(
      `SELECT COALESCE(SUM(points), 0) as total FROM wellness_points WHERE space_id = ? AND DATE(earned_at) = ?`,
      [space_id, today]
    );

    return success(res, {
      id: level.id,
      space_id: level.space_id,
      current_level: level.current_level,
      total_xp: level.total_xp,
      level_xp: level.level_xp,
      xp_for_next_level: xpForNextLevel,
      progress_pct: progressPct,
      title: level.title,
      avatar_url: level.avatar_url,
      points_today: todayPoints?.total || 0,
      updated_at: level.updated_at
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/gamification/summary error');
    return error(res, 'FETCH_GAMIFICATION_SUMMARY_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/wellness/gamification/achievements
 * Get all achievements with user progress
 */
router.get('/gamification/achievements', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    // Get all achievements with user progress
    const achievements = await dbAll(`
      SELECT
        a.*,
        ua.earned_at,
        COALESCE(ua.progress, 0) as progress
      FROM wellness_achievements a
      LEFT JOIN wellness_user_achievements ua ON a.id = ua.achievement_id AND ua.space_id = ?
      WHERE a.is_active = true
      ORDER BY a.category, a.tier, a.id
    `, [space_id]);

    const result = (achievements || []).map(a => ({
      ...a,
      earned: !!a.earned_at,
      condition: typeof a.condition === 'string' ? JSON.parse(a.condition) : a.condition
    }));

    return success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/gamification/achievements error');
    return error(res, 'FETCH_ACHIEVEMENTS_ERROR', err.message, 500);
  }
});

// =============================================================================
// STREAKS ROUTES
// =============================================================================

/**
 * GET /api/v3/wellness/streaks
 * Get all streaks for a space
 */
router.get('/streaks', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    const streaks = await dbAll(
      'SELECT * FROM wellness_streaks WHERE space_id = ?',
      [space_id]
    );

    // Transform to object by streak_type
    const result = {};
    for (const streak of (streaks || [])) {
      result[streak.streak_type] = {
        current_count: streak.current_count,
        longest_count: streak.longest_count,
        last_activity_date: streak.last_activity_date,
        started_at: streak.started_at
      };
    }

    // Add defaults for missing streak types
    const defaultStreakTypes = ['vitals_logged', 'workout', 'nutrition_logged'];
    for (const type of defaultStreakTypes) {
      if (!result[type]) {
        result[type] = {
          current_count: 0,
          longest_count: 0,
          last_activity_date: null,
          started_at: null
        };
      }
    }

    return success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/streaks error');
    return error(res, 'FETCH_STREAKS_ERROR', err.message, 500);
  }
});

// =============================================================================
// DASHBOARD ROUTES
// =============================================================================

/**
 * GET /api/v3/wellness/dashboard
 * Get aggregated daily status
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { space_id } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    const today = new Date().toISOString().split('T')[0];

    // Get today's vitals
    const vitalsToday = await dbAll(
      `SELECT * FROM wellness_vitals WHERE space_id = ? AND DATE(measured_at) = ? ORDER BY measured_at DESC`,
      [space_id, today]
    );

    // Get latest vitals
    const latestVitals = {};
    for (const vitalType of VALID_VITAL_TYPES) {
      const latest = await dbGet(
        'SELECT * FROM wellness_vitals WHERE space_id = ? AND vital_type = ? ORDER BY measured_at DESC LIMIT 1',
        [space_id, vitalType]
      );
      if (latest) {
        latestVitals[vitalType] = latest;
      }
    }

    // Get level info
    let level = await dbGet('SELECT * FROM wellness_levels WHERE space_id = ?', [space_id]);
    if (!level) {
      level = { current_level: 1, total_xp: 0, title: 'Beginner' };
    }

    // Get streaks
    const streaks = await dbAll('SELECT * FROM wellness_streaks WHERE space_id = ?', [space_id]);
    const streaksMap = {};
    for (const s of (streaks || [])) {
      streaksMap[s.streak_type] = s;
    }

    // Get today's points
    const todayPoints = await dbGet(
      `SELECT COALESCE(SUM(points), 0) as total FROM wellness_points WHERE space_id = ? AND DATE(earned_at) = ?`,
      [space_id, today]
    );

    return success(res, {
      date: today,
      vitals_today: vitalsToday || [],
      latest_vitals: latestVitals,
      level: {
        current: level.current_level,
        total_xp: level.total_xp,
        title: level.title
      },
      streaks: streaksMap,
      points_today: todayPoints?.total || 0
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /wellness/dashboard error');
    return error(res, 'FETCH_DASHBOARD_ERROR', err.message, 500);
  }
});

export default router;
