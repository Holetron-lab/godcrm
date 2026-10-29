import express from 'express';
import { z } from 'zod';
import { dbAll, dbGet, withTransactionAsync } from '../../../database/connection.js';
import { success, error, forbidden, notFound } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import { getEffectiveRole, ACCESS_LEVEL_VALUES } from '../../../services/EffectiveRoleService.js';
import { canAccessTable, canAccessProject, canAccessSpace } from '../../../services/SpaceService.js';
import { filterColumnsByRole, resolveUserRoleForTable } from './helpers.js';
import { canSummarizeSource, summarizeMysqlSource } from './sourceSummary.js';

const hasScope = (input) => Boolean(input.rowIds || input.searchQuery)
  || Object.values(input.selectFilters || {}).some(values => values.length > 0)
  || Object.values(input.dateFilters || {}).some(range => range.from || range.to)
  || Object.keys(input.filter || {}).length > 0;

const router = express.Router();
const id = z.string().regex(/^[1-9]\d*$/).refine(v => Number.isSafeInteger(Number(v)) && Number(v) <= 2147483647);
const date = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const schema = z.object({ data: z.object({
  columnIds: z.array(id).min(1).max(200).optional(),
  rowIds: z.array(id).max(10000).optional(),
  searchQuery: z.string().max(1000).optional(),
  searchColumns: z.array(id).max(200).optional(),
  filter: z.record(z.string().min(1).max(200), z.union([z.string().max(1000), z.number().finite(), z.boolean()])).optional(),
  selectFilters: z.record(id, z.array(z.string().max(1000)).max(200)).optional(),
  dateFilters: z.record(id, z.object({ from: date.optional(), to: date.optional() }).strict()).optional(),
}).strict() }).strict();

// Read-only POST: complex filter/selection payloads must not be truncated by URL limits.
router.post('/tables/:tableId/summary', async (req, res) => {
  try {
    if (!req.user?.id) return error(res, 'UNAUTHORIZED', 'Authentication required', 401);
    const parsedId = id.safeParse(req.params.tableId);
    const parsed = schema.safeParse(req.body);
    if (!parsedId.success || !parsed.success) return error(res, 'INVALID_SUMMARY', 'Invalid summary request', 400);
    const tableId = Number(parsedId.data);
    const table = await dbGet(`SELECT t.*, p.space_id FROM universal_tables t
      LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`, [tableId]);
    if (!table) return notFound(res, 'Table');
    const user = req.user;
    if ((user.projectId && Number(user.projectId) !== Number(table.project_id)) ||
      [ ['allowedTables', tableId], ['allowedProjects', table.project_id], ['allowedSpaces', table.space_id] ]
        .some(([key, value]) => user[key] && !user[key].map(String).includes(String(value)))) {
      return forbidden(res, 'Your API key does not have access to this table');
    }
    let { userRole, userAccessData } = await resolveUserRoleForTable(user.id, table);
    if (userAccessData && (!canAccessSpace(userAccessData, table.space_id) ||
      !canAccessProject(userAccessData, table.project_id) || !canAccessTable(userAccessData, tableId))) {
      return forbidden(res, 'You do not have access to this table');
    }
    const effective = await getEffectiveRole(user.id, { tableId });
    if (effective.effectiveRole === 'denied' && effective.source !== 'none') return forbidden(res, 'You do not have access to this table');
    if (!userRole) {
      userRole = effective.effectiveRole;
      if (userRole === 'denied' && ['admin', 'owner'].includes(user.role)) userRole = user.role;
    }
    if ((ACCESS_LEVEL_VALUES[userRole] ?? 0) < ACCESS_LEVEL_VALUES.viewer) return forbidden(res, 'You do not have access to this table');
    if (table.is_system && table.sync_target) {
      return error(res, 'SUMMARY_SOURCE_UNSUPPORTED', 'Full summary is not available for this data source', 422);
    }
    const columns = filterColumnsByRole(await dbAll('SELECT id, column_name, type, config, is_from_source FROM table_columns WHERE table_id = ?', [tableId]), userRole, userAccessData);
    const input = parsed.data.data;
    if (table.data_source_id) {
      // Search, option and date filters run in the browser for source tables, so the
      // source can only answer for the whole table; a scoped request falls back client-side.
      if (hasScope(input)) return error(res, 'SUMMARY_SCOPE_UNSUPPORTED', 'Filtered totals are not available for this data source', 422);
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSource = table.source_table_name ? await new DataSourceService().get(table.data_source_id) : null;
      if (!canSummarizeSource(dataSource)) return error(res, 'SUMMARY_SOURCE_UNSUPPORTED', 'Full summary is not available for this data source', 422);
      const allowedIds = new Set(columns.map(c => String(c.id)));
      if ((input.columnIds || []).some(key => !allowedIds.has(key))) return error(res, 'INVALID_SUMMARY', 'Unknown or inaccessible column', 400);
      const requested = input.columnIds ? columns.filter(c => input.columnIds.includes(String(c.id))) : columns;
      return success(res, await summarizeMysqlSource(dataSource, table.source_table_name, requested));
    }
    const allowed = new Set(columns.map(c => String(c.id)));
    // Nested-table callers use field names; the SQL layer accepts only resolved IDs.
    const exactFilters = Object.entries(input.filter || {}).map(([key, value]) => [
      String(columns.find(c => String(c.id) === key || c.column_name === key)?.id), value,
    ]);
    input.filter = Object.fromEntries(exactFilters);
    if ([...(input.columnIds || []), ...(input.searchColumns || []),
      ...Object.keys(input.selectFilters || {}), ...Object.keys(input.dateFilters || {}), ...Object.keys(input.filter)]
      .some(key => !allowed.has(key))) return error(res, 'INVALID_SUMMARY', 'Unknown or inaccessible column', 400);

    // Compose fixed SQL only; bind JSON keys, IDs, values and regexes.
    const params = [];
    const bind = value => { params.push(value); return `$${params.length}`; };
    const tableParam = bind(tableId);
    const outputIds = input.columnIds || columns.map(c => String(c.id));
    const searchIds = input.searchQuery
      ? (input.searchColumns?.length ? input.searchColumns : columns.map(c => String(c.id))) : [];
    const optionIds = Object.entries(input.selectFilters || {}).filter(([, values]) => values.length).map(([id]) => id);
    const needed = new Set([...outputIds, ...searchIds, ...optionIds,
      ...Object.keys(input.filter), ...Object.keys(input.dateFilters || {})]);
    const definitions = bind(JSON.stringify(columns.filter(c => needed.has(String(c.id))).map(c => ({
      id: String(c.id), name: c.column_name, type: c.type,
      search: searchIds.includes(String(c.id)),
      options: optionIds.includes(String(c.id)) || ['multi-select', 'multi_select', 'multiselect'].includes(c.type),
    }))));
    const rowCondition = input.rowIds ? ` AND id = ANY(${bind(input.rowIds)}::bigint[])` : '';
    const conditions = [];
    if (input.searchQuery) {
      conditions.push(`EXISTS (SELECT 1 FROM cells c WHERE c.row_id = r.id
        AND c.column_id = ANY(${bind(searchIds)}::text[])
        AND strpos(lower(c.search_value), lower(${bind(input.searchQuery)})) > 0)`);
    }
    for (const [id, values] of Object.entries(input.selectFilters || {})) {
      if (values.length) conditions.push(`EXISTS (SELECT 1 FROM cells c WHERE c.row_id = r.id
        AND c.column_id = ${bind(id)} AND c.options && ${bind(values)}::text[])`);
    }
    for (const [id, value] of Object.entries(input.filter || {})) {
      conditions.push(`EXISTS (SELECT 1 FROM cells c WHERE c.row_id = r.id
        AND c.column_id = ${bind(id)} AND c.raw_text = ${bind(String(value))})`);
    }
    for (const [id, range] of Object.entries(input.dateFilters || {})) {
      if (!range.from && !range.to) continue;
      const bounds = [];
      if (range.from) bounds.push(`c.date_value >= ${bind(range.from)}::timestamptz`);
      if (range.to) bounds.push(range.to.length === 10
        ? `c.date_value < (${bind(range.to)}::date + 1)::timestamptz`
        : `c.date_value <= ${bind(range.to)}::timestamptz`);
      conditions.push(`EXISTS (SELECT 1 FROM cells c WHERE c.row_id = r.id
        AND c.column_id = ${bind(id)} AND ${bounds.join(' AND ')})`);
    }
    const requested = bind(outputIds);
    const numericPattern = bind('^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$');
    const sql = `
      WITH definitions AS (
        SELECT * FROM jsonb_to_recordset(${definitions}::jsonb) AS c(id text, name text, type text, search boolean, options boolean)
      ), source AS MATERIALIZED (
        SELECT id, data FROM table_rows WHERE table_id = ${tableParam}${rowCondition}
      ), raw_cells AS MATERIALIZED (
        ${needed.size === 1 ? `SELECT r.id AS row_id, c.id AS column_id, c.type, c.search,
          c.options AS needs_options,
          COALESCE(NULLIF(r.data::jsonb->c.name, 'null'::jsonb), r.data::jsonb->c.id) AS raw
          FROM source r CROSS JOIN definitions c` : `SELECT r.id AS row_id, c.id AS column_id, c.type, c.search, c.options AS needs_options,
          v.value AS raw
        FROM source r
        CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.data::jsonb) = 'object'
          THEN r.data::jsonb ELSE '{}'::jsonb END) v
        JOIN (
          SELECT *, name AS key, false AS alias FROM definitions
          UNION ALL SELECT *, id AS key, true AS alias FROM definitions WHERE id <> name
        ) c ON v.key = c.key
        WHERE CASE WHEN c.alias THEN NULLIF(r.data::jsonb->c.name, 'null'::jsonb) IS NULL
          ELSE v.value <> 'null'::jsonb END`}
      ), values_text AS (
        SELECT *, raw #>> '{}' AS raw_text, NULLIF(raw #>> '{}', '') AS value FROM raw_cells
      ), cells AS MATERIALIZED (
        SELECT row_id, column_id, type, ${Object.keys(input.filter).length ? 'raw_text' : 'NULL::text AS raw_text'}, value,
          CASE WHEN NOT search THEN NULL WHEN jsonb_typeof(raw) = 'array' THEN
            (SELECT string_agg(v, ',' ORDER BY ord) FROM jsonb_array_elements_text(raw) WITH ORDINALITY AS a(v, ord))
            WHEN jsonb_typeof(raw) = 'object' THEN '[object Object]'
            ELSE value END AS search_value,
          CASE WHEN NOT needs_options THEN NULL WHEN jsonb_typeof(raw) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(raw))
            WHEN left(value, 1) = '[' AND pg_input_is_valid(value, 'jsonb') THEN
              CASE WHEN jsonb_typeof(value::jsonb) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(value::jsonb)) ELSE ARRAY[value] END
            WHEN strpos(value, ',') > 0 OR strpos(value, ';') > 0 THEN ARRAY(
              SELECT btrim(v) FROM unnest(string_to_array(value, CASE WHEN strpos(value, ',') > 0 THEN ',' ELSE ';' END)) AS v
              WHERE btrim(v) <> '')
            ELSE ARRAY[value] END AS options,
          CASE WHEN type IN ('number', 'order', 'integer', 'float', 'decimal')
            AND (jsonb_typeof(raw) = 'number' OR value ~ ${numericPattern})
            AND pg_input_is_valid(value, 'double precision')
            THEN value::numeric END AS number_value,
          CASE WHEN type IN ('date', 'datetime') AND value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND pg_input_is_valid(value, 'timestamp with time zone')
            THEN value::timestamptz END AS date_value
        FROM values_text
      ), matched AS MATERIALIZED (
        SELECT r.id FROM source r ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ), selected AS MATERIALIZED (
        SELECT c.column_id, c.type, c.value, c.options, c.number_value, c.date_value
        FROM cells c ${conditions.length ? 'JOIN matched m ON m.id = c.row_id' : ''}
        WHERE c.column_id = ANY(${requested}::text[])
      ), stats AS (
        SELECT column_id, count(value) AS filled,
          count(DISTINCT value) AS unique_count, count(number_value) AS numeric_count,
          sum(number_value) AS sum, avg(number_value) AS avg, min(number_value) AS min, max(number_value) AS max,
          count(*) FILTER (WHERE value IN ('true', '1')) AS checked,
          count(date_value) AS date_count, min(date_value) AS earliest, max(date_value) AS latest
        FROM selected GROUP BY column_id
      ), option_counts AS MATERIALIZED (
        SELECT column_id, option, count(*) AS count
        FROM selected CROSS JOIN LATERAL unnest(
          CASE WHEN type IN ('multi-select', 'multi_select', 'multiselect') THEN options ELSE ARRAY[value] END
        ) AS option
        WHERE type IN ('select', 'multi-select', 'multi_select', 'multiselect') AND option IS NOT NULL AND option <> ''
        GROUP BY column_id, option
      )
      SELECT t.total,
        COALESCE(jsonb_object_agg(d.id, jsonb_build_object(
          'count', t.total, 'countFilled', COALESCE(s.filled, 0),
          'countEmpty', t.total - COALESCE(s.filled, 0), 'countUnique', COALESCE(s.unique_count, 0),
          'percentFilled', COALESCE(round(100.0 * s.filled / NULLIF(t.total, 0)), 0),
          'numericCount', COALESCE(s.numeric_count, 0), 'sum', COALESCE(s.sum, 0), 'avg', s.avg, 'min', s.min, 'max', s.max,
          'checked', COALESCE(s.checked, 0), 'unchecked', COALESCE(s.filled - s.checked, 0),
          'percentChecked', COALESCE(round(100.0 * s.checked / NULLIF(s.filled, 0)), 0),
          'dateCount', COALESCE(s.date_count, 0), 'earliest', s.earliest, 'latest', s.latest,
          'dateRange', EXTRACT(EPOCH FROM (s.latest - s.earliest)) / 86400,
          'valueCounts', COALESCE((SELECT jsonb_object_agg(o.option, o.count) FROM option_counts o WHERE o.column_id = d.id), '{}'::jsonb)
        )) FILTER (WHERE d.id IS NOT NULL), '{}'::jsonb) AS columns
      FROM (SELECT count(*) AS total FROM matched) t
      LEFT JOIN definitions d ON d.id = ANY(${requested}::text[])
      LEFT JOIN stats s ON s.column_id = d.id
      GROUP BY t.total`;
    const summary = await withTransactionAsync(async tx => {
      await tx.run('SET TRANSACTION READ ONLY');
      await tx.run("SET LOCAL TIME ZONE 'UTC'");
      // CTE/cardinality estimates otherwise trigger seconds of JIT compilation for an interactive query.
      await tx.run('SET LOCAL jit = off');
      const result = await tx.get(sql, params);
      for (const values of Object.values(result.columns)) {
        for (const key of ['earliest', 'latest']) if (values[key]) values[key] = new Date(values[key]).toISOString();
      }
      return { total: Number(result.total), columns: result.columns };
    });
    return success(res, summary);
  } catch (err) {
    apiLogger.error({ err }, 'Table summary failed');
    return error(res, 'SUMMARY_FAILED', 'Could not calculate table summary', 500);
  }
});

export default router;
