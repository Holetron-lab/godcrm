/**
 * Footer totals for a data-source table, aggregated in the source itself.
 *
 * The summary CTE in tableSummaryController reads table_rows, which a MySQL-backed table
 * does not have; the endpoint used to answer 422 and the grid summed the loaded pages only
 * (conversation 3660: 275 rows out of 15 675). Same response shape as the local path.
 */
import { isMysqlSource, openMysqlConnection } from '../../../services/data-source/mysql.js';

const SOURCE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const NUMBER_TYPES = new Set(['number', 'order', 'integer', 'float', 'decimal']);
const DATE_TYPES = new Set(['date', 'datetime']);
const OPTION_TYPES = new Set(['select', 'multi-select', 'multi_select', 'multiselect']);
const CHECK_TYPES = new Set(['checkbox', 'boolean']);
const TOP_OPTIONS = 20;

export const canSummarizeSource = (dataSource) => isMysqlSource(dataSource);

const emptySummary = (total) => ({
  count: total, countFilled: 0, countEmpty: total, countUnique: 0, percentFilled: 0,
  numericCount: 0, sum: 0, avg: null, min: null, max: null,
  checked: 0, unchecked: 0, percentChecked: 0,
  dateCount: 0, earliest: null, latest: null, dateRange: null, valueCounts: {},
});

const num = (value) => (value === null || value === undefined ? null : Number(value));
const iso = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const isSourceColumn = (column) => column.is_from_source !== 0 && column.is_from_source !== false
  && SOURCE_IDENTIFIER.test(column.column_name);

/**
 * One aggregate query over the whole source table plus one GROUP BY per option column.
 * Virtual columns (values in table_rows) report the empty summary.
 */
export async function summarizeMysqlSource(dataSource, sourceTable, columns) {
  if (!SOURCE_IDENTIFIER.test(sourceTable)) throw new Error('Invalid source table name');
  const table = `\`${sourceTable}\``;
  const connection = await openMysqlConnection(dataSource);
  try {
    // is_from_source is not proof: nested-table columns carry the flag but have no source column.
    const [fields] = await connection.execute(`SHOW COLUMNS FROM ${table}`);
    const present = new Set(fields.map(field => field.Field));
    const sourceColumns = columns.filter(column => isSourceColumn(column) && present.has(column.column_name));

    const selects = ['COUNT(*) AS total'];
    sourceColumns.forEach((column, i) => {
      const col = `\`${column.column_name}\``;
      // Compared as text: NULLIF(date_col, '') is an error under strict SQL mode.
      const text = `CAST(${col} AS CHAR)`;
      const value = `NULLIF(${text}, '')`;
      selects.push(`COUNT(${value}) AS f${i}`, `COUNT(DISTINCT ${value}) AS u${i}`);
      if (NUMBER_TYPES.has(column.type)) {
        selects.push(`SUM(${col}) AS s${i}`, `AVG(${col}) AS a${i}`, `MIN(${col}) AS mn${i}`, `MAX(${col}) AS mx${i}`);
      }
      if (DATE_TYPES.has(column.type)) selects.push(`MIN(${col}) AS e${i}`, `MAX(${col}) AS l${i}`);
      if (CHECK_TYPES.has(column.type)) selects.push(`SUM(CASE WHEN ${text} IN ('1', 'true') THEN 1 ELSE 0 END) AS c${i}`);
    });

    const [[stats]] = await connection.execute(`SELECT ${selects.join(', ')} FROM ${table}`);
    const total = Number(stats.total) || 0;
    const result = { total, columns: {} };
    for (const column of columns) result.columns[String(column.id)] = emptySummary(total);

    for (const [i, column] of sourceColumns.entries()) {
      const summary = result.columns[String(column.id)];
      const filled = Number(stats[`f${i}`]) || 0;
      summary.countFilled = filled;
      summary.countEmpty = total - filled;
      summary.countUnique = Number(stats[`u${i}`]) || 0;
      summary.percentFilled = total ? Math.round((100 * filled) / total) : 0;
      if (NUMBER_TYPES.has(column.type)) {
        summary.numericCount = filled;
        summary.sum = num(stats[`s${i}`]) ?? 0;
        summary.avg = num(stats[`a${i}`]);
        summary.min = num(stats[`mn${i}`]);
        summary.max = num(stats[`mx${i}`]);
      }
      if (DATE_TYPES.has(column.type)) {
        summary.earliest = iso(stats[`e${i}`]);
        summary.latest = iso(stats[`l${i}`]);
        summary.dateCount = summary.earliest ? filled : 0;
        summary.dateRange = summary.earliest && summary.latest
          ? (new Date(summary.latest) - new Date(summary.earliest)) / 86400000 : null;
      }
      if (CHECK_TYPES.has(column.type)) {
        summary.checked = Number(stats[`c${i}`]) || 0;
        summary.unchecked = filled - summary.checked;
        summary.percentChecked = filled ? Math.round((100 * summary.checked) / filled) : 0;
      }
      if (OPTION_TYPES.has(column.type)) {
        const col = `\`${column.column_name}\``;
        const [options] = await connection.execute(
          `SELECT ${col} AS value, COUNT(*) AS count FROM ${table} WHERE NULLIF(CAST(${col} AS CHAR), '') IS NOT NULL
           GROUP BY ${col} ORDER BY count DESC LIMIT ${TOP_OPTIONS}`
        );
        for (const row of options) summary.valueCounts[String(row.value)] = Number(row.count);
      }
    }
    return result;
  } finally {
    await connection.end();
  }
}
