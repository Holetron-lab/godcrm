/**
 * Migration 033: Convert status column options from string[] to {value,label,color}[]
 * Ticket #40790 / ADR-088
 *
 * Existing documents registry tables have status columns with plain string
 * options (e.g. ["draft","published","deprecated"]).  The new format requires
 * structured objects: { value, label, color }.
 *
 * This migration:
 *   UP   – finds every table_columns row where column_name='status',
 *          type='select' and config.options contains plain strings,
 *          then converts each string to a { value, label, color } object.
 *   DOWN – reverts structured objects back to plain string arrays.
 *
 * The migration is idempotent: columns already in object format are skipped.
 */

/** Canonical colour palette keyed by known status value */
const STATUS_COLORS = {
  draft: '#eab308',
  review: '#a855f7',
  approved: '#3b82f6',
  published: '#22c55e',
  archived: '#6b7280',
  deprecated: '#ef4444',
};

/** Fallback colour for any status value not in the map above */
const DEFAULT_COLOR = '#94a3b8';

/**
 * Turn a slug-style value into a human-readable label.
 * 'in_review' → 'In review', 'draft' → 'Draft'
 */
function labelFromValue(value) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());
}

// ───────────────────────────── UP ─────────────────────────────

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';

  // Find all status/select columns across every table
  const result = await knex.raw(
    isPostgres
      ? `SELECT id, table_id, config
           FROM table_columns
          WHERE column_name = 'status'
            AND type = 'select'
            AND config IS NOT NULL`
      : `SELECT id, table_id, config
           FROM table_columns
          WHERE column_name = 'status'
            AND type = 'select'
            AND config IS NOT NULL`
  );

  const rows = isPostgres ? result.rows : result;
  let migratedCount = 0;

  for (const row of rows) {
    let config;
    try {
      config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    } catch {
      // unparseable config – skip
      continue;
    }

    const options = config?.options;
    if (!Array.isArray(options) || options.length === 0) continue;

    // Already migrated? (first element is an object with a 'value' key)
    if (typeof options[0] === 'object' && options[0] !== null && 'value' in options[0]) {
      continue;
    }

    // Convert plain strings → structured objects
    config.options = options.map(opt => {
      const value = String(opt);
      return {
        value,
        label: labelFromValue(value),
        color: STATUS_COLORS[value] || DEFAULT_COLOR,
      };
    });

    const newConfig = JSON.stringify(config);

    await knex.raw(
      isPostgres
        ? `UPDATE table_columns SET config = $1, updated_at = NOW() WHERE id = $2`
        : `UPDATE table_columns SET config = ?, updated_at = datetime('now') WHERE id = ?`,
      [newConfig, row.id]
    );

    migratedCount++;
  }

  console.log(
    `[Migration 033] Migrated ${migratedCount} status column(s) from string[] to {value,label,color}[] format`
  );
}

// ───────────────────────────── DOWN ───────────────────────────

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';

  // Find all status/select columns
  const result = await knex.raw(
    isPostgres
      ? `SELECT id, table_id, config
           FROM table_columns
          WHERE column_name = 'status'
            AND type = 'select'
            AND config IS NOT NULL`
      : `SELECT id, table_id, config
           FROM table_columns
          WHERE column_name = 'status'
            AND type = 'select'
            AND config IS NOT NULL`
  );

  const rows = isPostgres ? result.rows : result;
  let revertedCount = 0;

  for (const row of rows) {
    let config;
    try {
      config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    } catch {
      continue;
    }

    const options = config?.options;
    if (!Array.isArray(options) || options.length === 0) continue;

    // Only revert if currently in object format
    if (typeof options[0] !== 'object' || options[0] === null || !('value' in options[0])) {
      continue;
    }

    // Convert objects back to plain strings
    config.options = options.map(opt => opt.value);

    const newConfig = JSON.stringify(config);

    await knex.raw(
      isPostgres
        ? `UPDATE table_columns SET config = $1, updated_at = NOW() WHERE id = $2`
        : `UPDATE table_columns SET config = ?, updated_at = datetime('now') WHERE id = ?`,
      [newConfig, row.id]
    );

    revertedCount++;
  }

  console.log(
    `[Migration 033 DOWN] Reverted ${revertedCount} status column(s) from {value,label,color}[] back to string[] format`
  );
}
