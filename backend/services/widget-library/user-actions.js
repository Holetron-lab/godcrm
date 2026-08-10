/**
 * Widget Library — User Actions
 *
 * getFavorites, getRecent, toggleFavorite, trackUsage
 */

import { dbRun, dbGet, dbAll, safeJsonParse } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

/**
 * Get user's favorite widgets
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of favorite widgets with details
 */
export async function getFavorites(userId) {
  const favorites = await dbAll(`
    SELECT
      wl.widget_id,
      wl.space_id,
      wl.use_count,
      wl.last_used_at,
      wl.tags,
      w.title,
      w.preset_name,
      w.icon,
      w.config,
      s.name as space_name,
      uwf.created_at as favorited_at
    FROM user_widget_favorites uwf
    JOIN widget_library wl ON wl.widget_id = uwf.widget_id
    JOIN widgets w ON w.id = wl.widget_id
    JOIN spaces s ON s.id = wl.space_id
    WHERE uwf.user_id = ?
    ORDER BY uwf.created_at DESC
  `, [userId]);

  return favorites.map(item => ({
    ...item,
    config: safeJsonParse(item.config) || {},
    tags: safeJsonParse(item.tags) || []
  }));
}

/**
 * Get recently used widgets for a user
 * @param {number} userId - User ID
 * @param {number} limit - Max number of results (default 10)
 * @returns {Promise<Array>} Array of recently used widgets
 */
export async function getRecent(userId, limit = 10) {
  // Get distinct recent widgets, most recent first
  const recent = await dbAll(`
    SELECT DISTINCT
      wl.widget_id,
      wl.space_id,
      wl.use_count,
      wl.last_used_at,
      wl.tags,
      w.title,
      w.preset_name,
      w.icon,
      w.config,
      s.name as space_name,
      MAX(uwh.accessed_at) as last_accessed
    FROM user_widget_history uwh
    JOIN widget_library wl ON wl.widget_id = uwh.widget_id
    JOIN widgets w ON w.id = wl.widget_id
    JOIN spaces s ON s.id = wl.space_id
    WHERE uwh.user_id = ?
    GROUP BY wl.widget_id, wl.id, wl.space_id, wl.use_count, wl.last_used_at, wl.tags, w.title, w.preset_name, w.icon, w.config, s.name
    ORDER BY last_accessed DESC
    LIMIT ?
  `, [userId, limit]);

  return recent.map(item => ({
    ...item,
    config: safeJsonParse(item.config) || {},
    tags: safeJsonParse(item.tags) || []
  }));
}

/**
 * Toggle favorite status for a widget
 * Adds to favorites if not favorited, removes if already favorited
 * @param {number} userId - User ID
 * @param {number} widgetId - Widget ID
 * @returns {Promise<Object>} { is_favorite: boolean, widget_id: number }
 */
export async function toggleFavorite(userId, widgetId) {
  // Check widget exists
  const widget = await dbGet('SELECT id FROM widgets WHERE id = ?', [widgetId]);
  if (!widget) {
    throw new Error('Widget not found');
  }

  // Check if already favorited
  const existing = await dbGet(
    'SELECT id FROM user_widget_favorites WHERE user_id = ? AND widget_id = ?',
    [userId, widgetId]
  );

  if (existing) {
    // Remove from favorites
    await dbRun(
      'DELETE FROM user_widget_favorites WHERE user_id = ? AND widget_id = ?',
      [userId, widgetId]
    );
    logger.debug({ userId, widgetId }, 'Widget removed from favorites');
    return { is_favorite: false, widget_id: widgetId };
  } else {
    // Add to favorites
    await dbRun(
      'INSERT INTO user_widget_favorites (user_id, widget_id) VALUES (?, ?)',
      [userId, widgetId]
    );
    logger.debug({ userId, widgetId }, 'Widget added to favorites');
    return { is_favorite: true, widget_id: widgetId };
  }
}

/**
 * Track widget usage - increment count, update timestamp, add history
 * @param {number} userId - User ID
 * @param {number} widgetId - Widget ID
 * @returns {Promise<void>}
 */
export async function trackUsage(userId, widgetId) {
  // Check widget exists
  const widget = await dbGet('SELECT id FROM widgets WHERE id = ?', [widgetId]);
  if (!widget) {
    throw new Error('Widget not found');
  }

  // Check widget is in library
  const libEntry = await dbGet('SELECT id FROM widget_library WHERE widget_id = ?', [widgetId]);
  if (!libEntry) {
    // Widget not in library - just log and return
    logger.debug({ widgetId }, 'Widget not in library, skipping usage tracking');
    return;
  }

  // Update widget_library use_count and last_used_at
  await dbRun(`
    UPDATE widget_library
    SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE widget_id = ?
  `, [widgetId]);

  // Add history entry
  await dbRun(
    'INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)',
    [userId, widgetId]
  );

  logger.debug({ userId, widgetId }, 'Widget usage tracked');
}
