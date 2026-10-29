/**
 * Calendar & Search Tool Handlers (ADR-144 P3)
 *
 * Handles: list_events, create_event, update_event, delete_event, global_search, list_spaces
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow } from '../../database/connection.js';
import { parseRowData } from './data-tools.js';

// universal_tables.table_type column bound (VARCHAR(50), see migration 077).
const TABLE_TYPE_MAX_LEN = 50;

export const calendarToolHandlers = {
  async list_events({ start_date, end_date, space_id, limit = 100 }) {
    const pg = isPostgres();
    let paramIdx = 1;
    let query = 'SELECT * FROM calendar_events WHERE 1=1';
    const params = [];

    if (space_id) {
      query += pg ? ` AND space_id = $${paramIdx++}` : ' AND space_id = ?';
      params.push(space_id);
    }
    if (start_date) {
      query += pg ? ` AND start_time >= $${paramIdx++}` : ' AND start_time >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += pg ? ` AND start_time <= $${paramIdx++}` : ' AND start_time <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY start_time ASC';
    query += pg ? ` LIMIT $${paramIdx++}` : ' LIMIT ?';
    params.push(limit);

    const events = await dbAll(query, params);
    return { events, total: events.length };
  },

  async create_event({ title, start, end, description = '', space_id, all_day = false }, userId) {
    if (!title || !start) return { error: 'title and start are required' };

    const result = await dbRun(`
      INSERT INTO calendar_events (title, description, start_time, end_time, all_day, space_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [title, description, start, end || null, all_day ? 1 : 0, space_id || null, userId || 1]);

    return { success: true, event_id: result.lastInsertRowid, message: `Event "${title}" created` };
  },

  async update_event({ event_id, title, start, end, description, all_day }) {
    const event = await dbGet('SELECT * FROM calendar_events WHERE id = ?', [event_id]);
    if (!event) return { error: `Event ${event_id} not found` };

    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (start !== undefined) { updates.push('start_time = ?'); params.push(start); }
    if (end !== undefined) { updates.push('end_time = ?'); params.push(end); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (all_day !== undefined) { updates.push('all_day = ?'); params.push(all_day ? 1 : 0); }
    if (updates.length === 0) return { error: 'No fields to update' };

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(event_id);
    await dbRun(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ?`, params);
    return { success: true, message: `Event ${event_id} updated` };
  },

  async delete_event({ event_id }) {
    const event = await dbGet('SELECT id, title FROM calendar_events WHERE id = ?', [event_id]);
    if (!event) return { error: `Event ${event_id} not found` };

    await dbRun('DELETE FROM calendar_events WHERE id = ?', [event_id]);
    return { success: true, message: `Event "${event.title}" deleted` };
  },

  async global_search({ query, types, space_id, limit = 20, include_archived = false, table_type }) {
    // ADR-164 addendum (doc 232328): exact `table_type` marker filter. In that
    // mode only tables are searched and `query` is optional; otherwise legacy
    // query-required behaviour is kept.
    const byType = table_type !== undefined;
    if (byType) {
      if (typeof table_type !== 'string' || !table_type.trim()) {
        return { error: 'table_type must be a non-empty string (exact marker, e.g. "ai_agents")' };
      }
      if (table_type.length > TABLE_TYPE_MAX_LEN) {
        return { error: `table_type must be at most ${TABLE_TYPE_MAX_LEN} characters` };
      }
      if (types !== undefined && !(Array.isArray(types) && types.length === 1 && types[0] === 'tables')) {
        return { error: 'table_type filter applies to tables only: pass types: ["tables"] or omit types' };
      }
    } else if (!query) {
      return { error: 'query is required (or pass table_type to search tables by marker)' };
    }

    const pg = isPostgres();
    const searchPattern = `%${query}%`;
    const results = {};

    const searchTypes = byType ? ['tables'] : (types || ['tables', 'rows', 'projects', 'conversations']);

    if (searchTypes.includes('tables')) {
      const where = [];
      const p = [];
      const bind = (col, value) => {
        p.push(value);
        where.push(pg ? `${col} = $${p.length}` : `${col} = ?`);
      };
      if (query) {
        p.push(searchPattern);
        where.push(pg ? `ut.name ILIKE $${p.length}` : 'ut.name LIKE ?');
      }
      if (byType) bind('ut.table_type', table_type);
      let q = 'SELECT ut.id, ut.name, ut.icon, ut.description, ut.table_type FROM universal_tables ut';
      if (space_id) {
        q += ' JOIN projects pr ON ut.project_id = pr.id';
        bind('pr.space_id', space_id);
      }
      if (where.length) q += ` WHERE ${where.join(' AND ')}`;
      p.push(limit);
      q += pg ? ` LIMIT $${p.length}` : ' LIMIT ?';
      results.tables = await dbAll(q, p);
    }

    if (searchTypes.includes('rows')) {
      // Archived rows are excluded by default so dead docs don't pollute
      // agent context (collegium decision 2026-07-04: archived over tombstone).
      const archivedFilter = include_archived ? '' : (pg
        ? ` AND (data->>'status' IS DISTINCT FROM 'archived')`
        : ` AND json_extract(data, '$.status') IS NOT 'archived'`);
      const rows = await dbAll(
        pg ? `SELECT id, table_id, LEFT(data::text, 200) as data_preview FROM table_rows WHERE data::text ILIKE $1${archivedFilter} LIMIT $2`
           : `SELECT id, table_id, substr(data, 1, 200) as data_preview FROM table_rows WHERE data LIKE ?${archivedFilter} LIMIT ?`,
        [searchPattern, limit]
      );
      results.rows = rows;
    }

    if (searchTypes.includes('projects')) {
      let q = pg
        ? 'SELECT id, name, icon, description FROM projects WHERE name ILIKE $1'
        : 'SELECT id, name, icon, description FROM projects WHERE name LIKE ?';
      const p = [searchPattern];
      if (space_id) {
        q += pg ? ` AND space_id = $2` : ' AND space_id = ?';
        p.push(space_id);
      }
      q += pg ? ` LIMIT $${p.length + 1}` : ' LIMIT ?';
      p.push(limit);
      results.projects = await dbAll(q, p);
    }

    if (searchTypes.includes('conversations')) {
      const convs = await dbAll(
        pg ? 'SELECT id, title, type FROM conversations WHERE title ILIKE $1 LIMIT $2'
           : 'SELECT id, title, type FROM conversations WHERE title LIKE ? LIMIT ?',
        [searchPattern, limit]
      );
      results.conversations = convs;
    }

    return { query: query || '', results };
  },

  async list_spaces() {
    const spaces = await dbAll('SELECT id, name, type, icon, created_at FROM spaces ORDER BY id');
    return { spaces, total: spaces.length };
  }
};
