/**
 * fitness/analyticsController.js — Analytics endpoints (summary, volume, PRs, streaks, muscle volume, exercise stats)
 */

import express from 'express';
import { dbAll, dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error } from '../../../utils/response.js';

const router = express.Router();

// =============================================================================
// ANALYTICS API
// =============================================================================

/**
 * GET /api/v3/fitness/analytics/summary
 * Get overall workout summary stats
 */
router.get('/analytics/summary', async (req, res) => {
  try {
    const { space_id } = req.query;

    // Total workouts
    const workoutStats = await dbGet(`
      SELECT COUNT(*) as total_workouts
      FROM fitness_workouts
      WHERE space_id = ?
    `, [space_id]);

    // Total sets and volume
    const setStats = await dbGet(`
      SELECT
        COUNT(*) as total_sets,
        COALESCE(SUM(weight_kg * reps), 0) as total_volume,
        COALESCE(SUM(CASE WHEN is_pr = true THEN 1 ELSE 0 END), 0) as total_prs
      FROM fitness_sets s
      JOIN fitness_workouts w ON s.workout_id = w.id
      WHERE w.space_id = ?
    `, [space_id]);

    return success(res, {
      total_workouts: Number(workoutStats?.total_workouts) || 0,
      total_sets: Number(setStats?.total_sets) || 0,
      total_volume: Number(setStats?.total_volume) || 0,
      total_prs: Number(setStats?.total_prs) || 0
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/summary error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/analytics/volume
 * Get volume data by day or exercise
 */
router.get('/analytics/volume', async (req, res) => {
  try {
    const { space_id, period = 'week', group_by = 'day' } = req.query;

    let data;

    if (group_by === 'exercise') {
      data = await dbAll(`
        SELECT
          s.exercise_name as exercise,
          SUM(s.weight_kg * s.reps) as volume,
          COUNT(*) as sets
        FROM fitness_sets s
        JOIN fitness_workouts w ON s.workout_id = w.id
        WHERE w.space_id = ?
        GROUP BY s.exercise_name
        ORDER BY volume DESC
      `, [space_id]);
    } else {
      // Group by day
      data = await dbAll(`
        SELECT
          DATE(w.started_at) as date,
          SUM(s.weight_kg * s.reps) as volume,
          COUNT(*) as sets
        FROM fitness_sets s
        JOIN fitness_workouts w ON s.workout_id = w.id
        WHERE w.space_id = ?
        GROUP BY DATE(w.started_at)
        ORDER BY date DESC
        LIMIT 30
      `, [space_id]);
    }

    return success(res, data || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/volume error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/analytics/prs
 * Get personal records
 */
router.get('/analytics/prs', async (req, res) => {
  try {
    const { space_id, limit = 20 } = req.query;

    const prs = await dbAll(`
      SELECT
        s.exercise_name,
        s.weight_kg,
        s.reps,
        w.started_at as achieved_at
      FROM fitness_sets s
      JOIN fitness_workouts w ON s.workout_id = w.id
      WHERE w.space_id = ? AND s.is_pr = true
      ORDER BY w.started_at DESC
      LIMIT ?
    `, [space_id, parseInt(limit)]);

    return success(res, prs || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/prs error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/analytics/streak
 * Get workout streak information
 */
router.get('/analytics/streak', async (req, res) => {
  try {
    const { space_id } = req.query;

    // Get all workout dates
    const workouts = await dbAll(`
      SELECT DISTINCT DATE(started_at) as workout_date
      FROM fitness_workouts
      WHERE space_id = ?
      ORDER BY workout_date DESC
    `, [space_id]);

    // Calculate current streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const today = new Date().toISOString().split('T')[0];
    const workoutDates = new Set(workouts.map(w => w.workout_date));

    // Count workouts this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const workoutsThisWeek = workouts.filter(w =>
      new Date(w.workout_date) >= weekAgo
    ).length;

    // Calculate streaks (simplified - consecutive days)
    if (workouts.length > 0) {
      for (let i = 0; i < workouts.length; i++) {
        const current = new Date(workouts[i].workout_date);
        const next = i + 1 < workouts.length ? new Date(workouts[i + 1].workout_date) : null;

        tempStreak++;

        if (!next || (current - next) > 86400000 * 2) { // Gap > 2 days
          longestStreak = Math.max(longestStreak, tempStreak);
          if (i === 0 || i <= 2) currentStreak = tempStreak;
          tempStreak = 0;
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak);
    }

    return success(res, {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      workouts_this_week: workoutsThisWeek,
      total_workout_days: workouts.length
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/streak error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/analytics/muscle-volume
 * Get volume by muscle group
 */
router.get('/analytics/muscle-volume', async (req, res) => {
  try {
    const { space_id } = req.query;

    const muscleVolume = await dbAll(`
      SELECT
        COALESCE(e.primary_muscle, 'other') as muscle,
        SUM(s.weight_kg * s.reps) as volume
      FROM fitness_sets s
      JOIN fitness_workouts w ON s.workout_id = w.id
      LEFT JOIN fitness_exercises e ON LOWER(s.exercise_name) = LOWER(e.name)
      WHERE w.space_id = ?
      GROUP BY COALESCE(e.primary_muscle, 'other')
      ORDER BY volume DESC
    `, [space_id]);

    return success(res, muscleVolume || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/muscle-volume error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/fitness/analytics/exercise/:exerciseName
 * Get analytics for a specific exercise
 */
router.get('/analytics/exercise/:exerciseName', async (req, res) => {
  try {
    const { exerciseName } = req.params;
    const { space_id } = req.query;

    const stats = await dbGet(`
      SELECT
        ? as exercise_name,
        COUNT(*) as total_sets,
        MAX(s.weight_kg) as max_weight,
        AVG(s.weight_kg) as avg_weight,
        MAX(s.reps) as max_reps,
        SUM(s.weight_kg * s.reps) as total_volume
      FROM fitness_sets s
      JOIN fitness_workouts w ON s.workout_id = w.id
      WHERE w.space_id = ? AND LOWER(s.exercise_name) = LOWER(?)
    `, [exerciseName, space_id, exerciseName]);

    // Calculate estimated 1RM using Brzycki formula
    const bestSet = await dbGet(`
      SELECT weight_kg, reps
      FROM fitness_sets s
      JOIN fitness_workouts w ON s.workout_id = w.id
      WHERE w.space_id = ? AND LOWER(s.exercise_name) = LOWER(?)
      ORDER BY weight_kg * (36.0 / (37.0 - reps)) DESC
      LIMIT 1
    `, [space_id, exerciseName]);

    let estimated1rm = 0;
    if (bestSet && bestSet.weight_kg && bestSet.reps) {
      // Brzycki formula: 1RM = weight * (36 / (37 - reps))
      const weight = Number(bestSet.weight_kg);
      const reps = Number(bestSet.reps);
      estimated1rm = weight * (36.0 / (37.0 - Math.min(reps, 36)));
    }

    return success(res, {
      exercise_name: stats?.exercise_name || exerciseName,
      total_sets: Number(stats?.total_sets) || 0,
      max_weight: Number(stats?.max_weight) || 0,
      avg_weight: Number(stats?.avg_weight) || 0,
      max_reps: Number(stats?.max_reps) || 0,
      total_volume: Number(stats?.total_volume) || 0,
      estimated_1rm: Math.round(estimated1rm * 10) / 10
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /fitness/analytics/exercise/:name error');
    return error(res, 'ANALYTICS_FAILED', err.message, 500);
  }
});

export default router;
