// wellness/helpers.js — Constants and shared helper functions

import { dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export const VALID_VITAL_TYPES = [
  'weight', 'heart_rate', 'blood_pressure_sys', 'blood_pressure_dia',
  'temperature', 'spo2', 'blood_glucose', 'body_fat_pct', 'body_battery'
];

export const VALID_ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

export const POINTS_CONFIG = {
  log_vital: 5,
  log_workout: 20,
  log_meal: 5,
  streak_bonus_pct: 10
};

export const LEVEL_TITLES = {
  1: 'Beginner',
  5: 'Health Apprentice',
  10: 'Wellness Warrior',
  20: 'Health Master',
  30: 'Wellness Guru',
  50: 'Health Legend',
  100: 'Wellness God'
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate BMR using Mifflin-St Jeor Equation
 */
export function calculateBMR(gender, weightKg, heightCm, age) {
  if (!weightKg || !heightCm || !age) return null;

  if (gender === 'male') {
    return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
  } else {
    return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age - 161);
  }
}

/**
 * Calculate TDEE from BMR and activity level
 */
export function calculateTDEE(bmr, activityLevel) {
  if (!bmr) return null;
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || 1.2;
  return Math.round(bmr * multiplier);
}

/**
 * Calculate age from birth date
 */
export function calculateAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate XP required to reach a target level (from level before it)
 * xpForLevel(2) = 100 (to go from Level 1 to 2)
 * xpForLevel(3) = 200 (to go from Level 2 to 3)
 * Formula: (targetLevel - 1) * 100
 */
export function xpForLevel(targetLevel) {
  return (targetLevel - 1) * 100;
}

/**
 * Get title for level
 */
export function getTitleForLevel(level) {
  const levels = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const l of levels) {
    if (level >= l) return LEVEL_TITLES[l];
  }
  return 'Beginner';
}

/**
 * Award points and check for level up
 */
export async function awardPoints(spaceId, points, sourceType, sourceId = null, reason = null) {
  try {
    // Insert points record
    await dbRun(`
      INSERT INTO wellness_points (space_id, points, source_type, source_id, reason, earned_at)
      VALUES (?, ?, ?, ?, ?, ${sqlNow()})
    `, [spaceId, points, sourceType, sourceId, reason]);

    // Get or create level entry
    let level = await dbGet('SELECT * FROM wellness_levels WHERE space_id = ?', [spaceId]);

    if (!level) {
      await dbRun(`
        INSERT INTO wellness_levels (space_id, current_level, total_xp, level_xp, title, updated_at)
        VALUES (?, 1, 0, 0, 'Beginner', ${sqlNow()})
      `, [spaceId]);
      level = await dbGet('SELECT * FROM wellness_levels WHERE space_id = ?', [spaceId]);
    }

    // Update XP
    const newTotalXP = (level.total_xp || 0) + points;
    let newLevelXP = (level.level_xp || 0) + points;
    let currentLevel = level.current_level || 1;

    // Check for level up
    let xpNeeded = xpForLevel(currentLevel + 1);
    while (newLevelXP >= xpNeeded) {
      newLevelXP -= xpNeeded;
      currentLevel++;
      xpNeeded = xpForLevel(currentLevel + 1);
    }

    const newTitle = getTitleForLevel(currentLevel);

    await dbRun(`
      UPDATE wellness_levels
      SET total_xp = ?, level_xp = ?, current_level = ?, title = ?, updated_at = ${sqlNow()}
      WHERE space_id = ?
    `, [newTotalXP, newLevelXP, currentLevel, newTitle, spaceId]);

    return { totalXP: newTotalXP, level: currentLevel, title: newTitle };
  } catch (error) {
    apiLogger.error({ err: error, spaceId, points }, 'awardPoints error');
    throw error;
  }
}

/**
 * Update streak for a type
 */
export async function updateStreak(spaceId, streakType, activityDate) {
  try {
    const dateStr = activityDate.split('T')[0]; // YYYY-MM-DD

    let streak = await dbGet(
      'SELECT * FROM wellness_streaks WHERE space_id = ? AND streak_type = ?',
      [spaceId, streakType]
    );

    if (!streak) {
      // Create new streak
      await dbRun(`
        INSERT INTO wellness_streaks (space_id, streak_type, current_count, longest_count, last_activity_date, started_at, updated_at)
        VALUES (?, ?, 1, 1, ?, ?, ${sqlNow()})
      `, [spaceId, streakType, dateStr, dateStr]);
      return { current_count: 1, longest_count: 1 };
    }

    const lastDate = new Date(streak.last_activity_date);
    const currentDate = new Date(dateStr);
    const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));

    let newCount;
    let newLongest = streak.longest_count || 0;
    let startedAt = streak.started_at;

    if (daysDiff === 0) {
      // Same day, no change
      newCount = streak.current_count;
    } else if (daysDiff === 1) {
      // Consecutive day, increment
      newCount = (streak.current_count || 0) + 1;
      if (newCount > newLongest) newLongest = newCount;
    } else if (daysDiff <= 2) {
      // 48h grace period for workout, increment
      newCount = (streak.current_count || 0) + 1;
      if (newCount > newLongest) newLongest = newCount;
    } else {
      // Streak broken, reset
      newCount = 1;
      startedAt = dateStr;
    }

    await dbRun(`
      UPDATE wellness_streaks
      SET current_count = ?, longest_count = ?, last_activity_date = ?, started_at = ?, updated_at = ${sqlNow()}
      WHERE space_id = ? AND streak_type = ?
    `, [newCount, newLongest, dateStr, startedAt, spaceId, streakType]);

    return { current_count: newCount, longest_count: newLongest };
  } catch (error) {
    apiLogger.error({ err: error, spaceId, streakType }, 'updateStreak error');
    throw error;
  }
}
