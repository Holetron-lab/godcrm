/**
 * Widget Library — Browsing & Filtering
 *
 * getLibraryWidgets, parseItems, getCategoryCounts
 */

import { dbGet, dbAll, safeJsonParse } from '../../database/connection.js';

/**
 * Parse items JSON fields
 */
export function parseItems(items) {
  return items.map(item => ({
    ...item,
    config: safeJsonParse(item.config) || {},
    tags: safeJsonParse(item.tags) || [],
    is_own_space: Boolean(item.is_own_space),
    is_favorite: Boolean(item.is_favorite),
    is_public: Boolean(item.is_public),
    is_template: Boolean(item.is_template)
  }));
}

/**
 * Get category counts for the widget library sidebar
 */
export async function getCategoryCounts(spaceId, userId, include_public = 0) {
  // Count favorites
  const favoritesCount = await dbGet(`
    SELECT COUNT(DISTINCT uwf.widget_id) as count
    FROM user_widget_favorites uwf
    JOIN widget_library wl ON wl.widget_id = uwf.widget_id
    WHERE uwf.user_id = ?
      AND (wl.space_id = ? OR (wl.is_public = true AND ?))
  `, [userId || 0, spaceId, include_public]);

  // Count recent
  const recentCount = await dbGet(`
    SELECT COUNT(DISTINCT uwh.widget_id) as count
    FROM user_widget_history uwh
    JOIN widget_library wl ON wl.widget_id = uwh.widget_id
    WHERE uwh.user_id = ?
      AND (wl.space_id = ? OR (wl.is_public = true AND ?))
  `, [userId || 0, spaceId, include_public]);

  // Count this_space
  const thisSpaceCount = await dbGet(`
    SELECT COUNT(*) as count
    FROM widget_library
    WHERE space_id = ?
  `, [spaceId]);

  // Count all_spaces (current + public)
  const allSpacesCount = await dbGet(`
    SELECT COUNT(*) as count
    FROM widget_library
    WHERE space_id = ? OR is_public = true
  `, [spaceId]);

  return {
    favorites: Number(favoritesCount?.count) || 0,
    recent: Number(recentCount?.count) || 0,
    this_space: Number(thisSpaceCount?.count) || 0,
    all_spaces: Number(allSpacesCount?.count) || 0
  };
}

/**
 * Get library widgets with filters
 * @param {number} spaceId - Current space
 * @param {Object} options - Filter options
 * @param {boolean} options.include_public - Include public widgets from other spaces
 * @param {string} options.category - Filter by category: 'favorites' | 'recent' | 'this_space' | 'all_spaces'
 * @param {string} options.search - Search by title or tags
 * @param {number} options.limit - Pagination limit
 * @param {number} options.offset - Pagination offset
 * @param {number} options.userId - Current user ID for favorites/recent
 * @returns {Promise<Object>} { items, total, categories }
 */
export async function getLibraryWidgets(spaceId, options = {}) {
  const {
    include_public: _include_public = false,
    category = null,
    search = null,
    limit = 50,
    offset = 0,
    userId = null
  } = options;

  const include_public = _include_public ? 1 : 0;

  let baseQuery = '';
  let whereClause = '';
  const params = [];

  // Handle category filtering
  if (category === 'favorites') {
    // Only favorites
    baseQuery = `
      SELECT
        wl.id as library_id,
        wl.widget_id,
        wl.space_id,
        wl.is_public,
        wl.is_template,
        wl.use_count,
        wl.last_used_at,
        wl.tags,
        w.title,
        w.preset_name,
        w.icon,
        w.config,
        w.widget_type,
        s.name as space_name,
        (wl.space_id = ?) as is_own_space,
        1 as is_favorite
      FROM widget_library wl
      JOIN widgets w ON w.id = wl.widget_id
      JOIN spaces s ON s.id = wl.space_id
      JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
      WHERE (wl.space_id = ? OR (wl.is_public = true AND ?))
    `;
    params.push(spaceId, userId || 0, spaceId, include_public);
  } else if (category === 'recent') {
    // Only recently used widgets
    baseQuery = `
      SELECT DISTINCT
        wl.id as library_id,
        wl.widget_id,
        wl.space_id,
        wl.is_public,
        wl.is_template,
        wl.use_count,
        wl.last_used_at,
        wl.tags,
        w.title,
        w.preset_name,
        w.icon,
        w.config,
        w.widget_type,
        s.name as space_name,
        (wl.space_id = ?) as is_own_space,
        (uwf.id IS NOT NULL) as is_favorite,
        MAX(uwh.accessed_at) as recent_access
      FROM user_widget_history uwh
      JOIN widget_library wl ON wl.widget_id = uwh.widget_id
      JOIN widgets w ON w.id = wl.widget_id
      JOIN spaces s ON s.id = wl.space_id
      LEFT JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
      WHERE uwh.user_id = ?
        AND (wl.space_id = ? OR (wl.is_public = true AND ?))
    `;
    params.push(spaceId, userId || 0, userId, spaceId, include_public);
  } else if (category === 'this_space') {
    // Only current space
    baseQuery = `
      SELECT
        wl.id as library_id,
        wl.widget_id,
        wl.space_id,
        wl.is_public,
        wl.is_template,
        wl.use_count,
        wl.last_used_at,
        wl.tags,
        w.title,
        w.preset_name,
        w.icon,
        w.config,
        w.widget_type,
        s.name as space_name,
        1 as is_own_space,
        (uwf.id IS NOT NULL) as is_favorite
      FROM widget_library wl
      JOIN widgets w ON w.id = wl.widget_id
      JOIN spaces s ON s.id = wl.space_id
      LEFT JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
      WHERE wl.space_id = ?
    `;
    params.push(userId || 0, spaceId);
  } else {
    // all_spaces or default: current space + optionally public
    if (include_public) {
      baseQuery = `
        SELECT
          wl.id as library_id,
          wl.widget_id,
          wl.space_id,
          wl.is_public,
          wl.is_template,
          wl.use_count,
          wl.last_used_at,
          wl.tags,
          w.title,
          w.preset_name,
          w.icon,
          w.config,
          w.widget_type,
          s.name as space_name,
          (wl.space_id = ?) as is_own_space,
          (uwf.id IS NOT NULL) as is_favorite
        FROM widget_library wl
        JOIN widgets w ON w.id = wl.widget_id
        JOIN spaces s ON s.id = wl.space_id
        LEFT JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
        WHERE (wl.space_id = ? OR wl.is_public = true)
      `;
      params.push(spaceId, userId || 0, spaceId);
    } else {
      baseQuery = `
        SELECT
          wl.id as library_id,
          wl.widget_id,
          wl.space_id,
          wl.is_public,
          wl.is_template,
          wl.use_count,
          wl.last_used_at,
          wl.tags,
          w.title,
          w.preset_name,
          w.icon,
          w.config,
          w.widget_type,
          s.name as space_name,
          1 as is_own_space,
          (uwf.id IS NOT NULL) as is_favorite
        FROM widget_library wl
        JOIN widgets w ON w.id = wl.widget_id
        JOIN spaces s ON s.id = wl.space_id
        LEFT JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
        WHERE wl.space_id = ?
      `;
      params.push(userId || 0, spaceId);
    }
  }

  // Add search filter
  if (search) {
    const searchPattern = `%${search}%`;
    baseQuery += ` AND (w.title LIKE ? OR wl.tags::text LIKE ?)`;
    params.push(searchPattern, searchPattern);
  }

  // Build count query - copy params before adding pagination
  const countParams = [...params];

  // Extract WHERE clause for count query
  const whereMatch = baseQuery.match(/WHERE[\s\S]*$/);
  whereClause = whereMatch ? whereMatch[0] : '';

  // Build count query based on category
  let countQuery;
  if (category === 'recent') {
    countQuery = `
      SELECT COUNT(DISTINCT wl.id) as total
      FROM user_widget_history uwh
      JOIN widget_library wl ON wl.widget_id = uwh.widget_id
      JOIN widgets w ON w.id = wl.widget_id
      JOIN spaces s ON s.id = wl.space_id
      LEFT JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
      WHERE uwh.user_id = ?
        AND (wl.space_id = ? OR (wl.is_public = true AND ?))
    `;
    // For recent, we need to rebuild countParams
    const recentCountParams = [userId || 0, userId, spaceId, include_public];
    if (search) {
      countQuery += ` AND (w.title LIKE ? OR wl.tags::text LIKE ?)`;
      recentCountParams.push(`%${search}%`, `%${search}%`);
    }
    const countResult = await dbGet(countQuery, recentCountParams);
    const total = Number(countResult?.total) || 0;

    // Add ordering and pagination
    baseQuery += ` GROUP BY wl.id, wl.widget_id, wl.space_id, wl.is_public, wl.is_template, wl.use_count, wl.last_used_at, wl.tags, w.title, w.preset_name, w.icon, w.config, w.widget_type, s.name, uwf.id ORDER BY recent_access DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = await dbAll(baseQuery, params);
    const categories = await getCategoryCounts(spaceId, userId, include_public);

    return {
      items: parseItems(items),
      total,
      categories
    };
  }

  // For non-recent queries
  if (category === 'favorites') {
    countQuery = `
      SELECT COUNT(DISTINCT wl.id) as total
      FROM widget_library wl
      JOIN widgets w ON w.id = wl.widget_id
      JOIN user_widget_favorites uwf ON uwf.widget_id = wl.widget_id AND uwf.user_id = ?
      WHERE (wl.space_id = ? OR (wl.is_public = true AND ?))
    `;
    const favCountParams = [userId || 0, spaceId, include_public];
    if (search) {
      countQuery += ` AND (w.title LIKE ? OR wl.tags::text LIKE ?)`;
      favCountParams.push(`%${search}%`, `%${search}%`);
    }
    const countResult = await dbGet(countQuery, favCountParams);
    const total = Number(countResult?.total) || 0;

    baseQuery += ` ORDER BY wl.use_count DESC, wl.last_used_at DESC, wl.id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = await dbAll(baseQuery, params);
    const categories = await getCategoryCounts(spaceId, userId, include_public);

    return {
      items: parseItems(items),
      total,
      categories
    };
  }

  // Default and this_space
  if (category === 'this_space' || !include_public) {
    countQuery = `
      SELECT COUNT(*) as total
      FROM widget_library wl
      JOIN widgets w ON w.id = wl.widget_id
      WHERE wl.space_id = ?
    `;
    const defaultCountParams = [spaceId];
    if (search) {
      countQuery += ` AND (w.title LIKE ? OR wl.tags::text LIKE ?)`;
      defaultCountParams.push(`%${search}%`, `%${search}%`);
    }
    const countResult = await dbGet(countQuery, defaultCountParams);
    const total = Number(countResult?.total) || 0;

    baseQuery += ` ORDER BY wl.use_count DESC, wl.last_used_at DESC, wl.id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = await dbAll(baseQuery, params);
    const categories = await getCategoryCounts(spaceId, userId, include_public);

    return {
      items: parseItems(items),
      total,
      categories
    };
  }

  // all_spaces with public
  countQuery = `
    SELECT COUNT(*) as total
    FROM widget_library wl
    JOIN widgets w ON w.id = wl.widget_id
    WHERE (wl.space_id = ? OR wl.is_public = true)
  `;
  const allCountParams = [spaceId];
  if (search) {
    countQuery += ` AND (w.title LIKE ? OR wl.tags::text LIKE ?)`;
    allCountParams.push(`%${search}%`, `%${search}%`);
  }
  const countResult = await dbGet(countQuery, allCountParams);
  const total = Number(countResult?.total) || 0;

  baseQuery += ` ORDER BY wl.use_count DESC, wl.last_used_at DESC, wl.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const items = await dbAll(baseQuery, params);
  const categories = await getCategoryCounts(spaceId, userId, include_public);

  return {
    items: parseItems(items),
    total,
    categories
  };
}
