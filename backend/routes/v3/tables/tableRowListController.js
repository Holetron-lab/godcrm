/**
 * Table row list controller
 * Handles: GET /tables/:tableId/rows (with pagination, filtering, search)
 */
import express from 'express';
import { z } from 'zod';
import { dbAll, dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { isMysqlSource, openMysqlConnection } from '../../../services/data-source/mysql.js';
import { forbidden, error } from '../../../utils/response.js';
import { checkTableAccess, respondRows } from './helpers.js';
import { buildOrderClause } from '../../../services/orderClause.js';

const router = express.Router();
const sortingSchema = z.object({
  sortColumn: z.string().regex(/^(\d+|__(sys_created_at|sys_updated_at|row_id|base_id))$/).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
}).refine(value => Boolean(value.sortColumn) === Boolean(value.sortDirection));

const SOURCE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Resolves ?sortColumn/?sortDirection for a data-source table to a column of the
 * source table — the only place its rows can be ordered before LIMIT/OFFSET.
 * null = the source's natural order (no sort requested, a virtual column whose
 * values live in table_rows, or a sort key the source has no column for);
 * false = the column does not belong to this table.
 */
async function resolveSourceSort(tableId, idColumn, { sortColumn, sortDirection }) {
  if (!sortColumn) return null;
  let name = { __row_id: idColumn, __base_id: idColumn }[sortColumn];
  if (!name) {
    if (!/^\d+$/.test(sortColumn)) return null;
    const column = await dbGet(
      'SELECT column_name, is_from_source FROM table_columns WHERE table_id = ? AND id = ?',
      [tableId, Number(sortColumn)]
    );
    if (!column) return false;
    if (column.is_from_source === 0 || column.is_from_source === false) return null;
    name = column.column_name;
  }
  if (!SOURCE_IDENTIFIER.test(name)) return null;
  return { name, direction: sortDirection.toUpperCase() };
}

/**
 * GET /api/v3/tables/:tableId/rows
 * Get rows for a table (with pagination)
 * Supports external data sources - reads directly from MySQL if connected
 * Supports filtering via ?filter={"column":"value"}
 */
router.get('/tables/:tableId/rows', async (req, res) => {
  try {
    const { tableId } = req.params;
    const sendRows = (payload) => respondRows(res, payload, { tableId, include: req.query.include, user: req.user });
    const { page = 1, limit = 50, mode, filter, search, searchColumns } = req.query;
    const rawMode = mode === 'raw';
    const offset = (Number(page) - 1) * Number(limit);

    // Check access if API key has project restriction
    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    // Parse filter if provided
    let filterObj = null;
    if (filter) {
      try { filterObj = JSON.parse(filter); } catch (e) { /* ignore invalid filter */ }
    }

    // Check if table has external data source or is a system table
    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column, is_system, sync_target, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    // If system table, fetch from real database tables
    if (table && table.is_system && table.sync_target) {
      apiLogger.debug({ syncTarget: table.sync_target, projectId: table.project_id }, 'Reading from system table');

      // ADR-175 P1 — mail is the only system table at business scale (100k+/account),
      // so it uses a SQL push-down path (WHERE/ORDER/LIMIT/OFFSET in the DB) instead of
      // the in-memory search/filter/slice() below used by the small system tables.
      // Same response shape; correct totals + fast pages at scale.
      if (table.sync_target === 'mail_messages') {
        const { getMailMessagesPage } = await import('../../../services/SystemTableService.js');
        const { rows, total } = await getMailMessagesPage(table.project_id, {
          search, searchColumns, filter: filterObj, page, limit
        });
        return await sendRows({
          rows,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          }
        });
      }

      const { getSystemTableData } = await import('../../../services/SystemTableService.js');
      let systemRowsResult = await getSystemTableData(table.sync_target, table.project_id);

      // Apply search filter if provided
      if (search) {
        const searchLower = String(search).toLowerCase();
        if (searchColumns) {
          const cols = String(searchColumns).split(',').map(c => c.trim());
          systemRowsResult = systemRowsResult.filter(row => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : row;
            return cols.some(col => {
              const val = rowData[col];
              return val !== undefined && val !== null && String(val).toLowerCase().includes(searchLower);
            });
          });
        } else {
          systemRowsResult = systemRowsResult.filter(row =>
            JSON.stringify(row).toLowerCase().includes(searchLower)
          );
        }
      }

      // Apply column filter if provided (Bug #75036)
      if (filterObj && Object.keys(filterObj).length > 0) {
        systemRowsResult = systemRowsResult.filter(row => {
          const rowData = row.data && typeof row.data === 'object' ? row.data : row;
          return Object.entries(filterObj).every(([col, val]) => {
            const cellValue = rowData[col];
            if (cellValue === undefined || cellValue === null) return false;
            return String(cellValue) === String(val);
          });
        });
      }

      // Apply pagination
      const start = offset;
      const end = offset + Number(limit);
      const paginatedRows = systemRowsResult.slice(start, end);

      return await sendRows({
        rows: paginatedRows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: systemRowsResult.length,
          pages: Math.ceil(systemRowsResult.length / Number(limit))
        }
      });
    }

    // If table is connected to external data source, read from there
    if (table && table.data_source_id && table.source_table_name) {
      apiLogger.debug({ dataSourceId: table.data_source_id, tableName: table.source_table_name }, 'Reading from data source');
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      // Header sorting is pushed down to the source; the grid shows one page at a time
      // and cannot order the rest client-side.
      const sorting = sortingSchema.safeParse(req.query);
      if (!sorting.success) return error(res, 'INVALID_SORT', 'Provide a column ID and asc/desc direction together', 400);
      const sourceSort = await resolveSourceSort(tableId, table.source_id_column || 'id', sorting.data);
      if (sourceSort === false) return error(res, 'INVALID_SORT', 'Sort column does not belong to this table', 400);

      // Internal data source - read from local database tables
      if (dataSource.type === 'internal') {
        apiLogger.debug({ tableName: table.source_table_name }, 'Reading from local database table');

        const orderClause = sourceSort ? `ORDER BY "${sourceSort.name}" ${sourceSort.direction} NULLS LAST` : '';
        const internalRows = await dbAll(
          `SELECT * FROM "${table.source_table_name}" ${orderClause} LIMIT ? OFFSET ?`,
          [Number(limit), offset]
        );

        const countResult = await dbGet(
          `SELECT COUNT(*) as total FROM "${table.source_table_name}"`
        );

        const total = countResult?.total || 0;
        const pages = Math.ceil(total / Number(limit));

        apiLogger.debug({ count: internalRows.length }, 'Internal rows fetched');

        const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ?', [tableId]);

        const idColumn = table.source_id_column || 'id';
        const rows = internalRows.map((row, index) => {
          const globalIndex = offset + index;
          const internalId = row[idColumn];
          const uniqueId = `int_${tableId}_${globalIndex}` + (internalId ? `_${internalId}` : '');

          let data;
          if (rawMode) {
            data = { ...row };
          } else {
            data = {};
            columns.forEach(col => {
              if (row[col.column_name] !== undefined) {
                data[col.id] = row[col.column_name];
              }
            });
          }

          return {
            id: uniqueId,
            table_id: tableId,
            base_id: internalId || uniqueId,
            data,
            created_by: 'internal',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || new Date().toISOString()
          };
        });

        return await sendRows({
          rows,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages
          }
        });
      }

      if (isMysqlSource(dataSource)) {
        const connection = await openMysqlConnection(dataSource);

        try {
          // Build WHERE clause for filter
          let whereClause = '';
          let whereValues = [];
          if (filterObj && Object.keys(filterObj).length > 0) {
            const conditions = [];
            for (const [col, val] of Object.entries(filterObj)) {
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
                apiLogger.warn({ col }, 'Invalid filter column name rejected');
                continue;
              }
              conditions.push(`\`${col}\` = ?`);
              whereValues.push(val);
            }
            if (conditions.length > 0) {
              whereClause = 'WHERE ' + conditions.join(' AND ');
            }
            apiLogger.debug({ whereClause, whereValues }, 'MySQL filter WHERE');
          }

          const orderClause = sourceSort ? `ORDER BY \`${sourceSort.name}\` ${sourceSort.direction}` : '';
          const [mysqlRows] = await connection.execute(
            `SELECT * FROM \`${table.source_table_name}\` ${whereClause} ${orderClause} LIMIT ${Number(limit)} OFFSET ${offset}`,
            whereValues
          );

          const [countResult] = await connection.execute(
            `SELECT COUNT(*) as total FROM \`${table.source_table_name}\` ${whereClause}`,
            whereValues
          );

          const total = countResult[0]?.total || 0;
          const pages = Math.ceil(total / Number(limit));

          const idColumn = table.source_id_column || 'id';

          // Get virtual columns (is_from_source = 0) for this table
          const virtualColumns = await dbAll(`
            SELECT id, column_name, default_value
            FROM table_columns
            WHERE table_id = ? AND is_from_source = 0
          `, [tableId]);

          // Build map of base_id -> virtual data from table_rows
          const rowIds = mysqlRows.map((row, index) => {
            const globalIndex = offset + index;
            const mysqlId = row[idColumn];
            return `ext_${tableId}_${globalIndex}` + (mysqlId ? `_${mysqlId}` : '');
          });

          // Fetch all virtual data for these rows in one query
          const virtualDataMap = {};
          if (rowIds.length > 0 && virtualColumns.length > 0) {
            const placeholders = rowIds.map(() => '?').join(',');
            const virtualRows = await dbAll(
              `SELECT base_id, data FROM table_rows WHERE table_id = ? AND base_id IN (${placeholders})`,
              [tableId, ...rowIds]
            );
            for (const vr of virtualRows) {
              try {
                virtualDataMap[vr.base_id] = typeof vr.data === 'string' ? JSON.parse(vr.data) : vr.data;
              } catch (e) {
                virtualDataMap[vr.base_id] = {};
              }
            }
          }

          const rows = mysqlRows.map((row, index) => {
            const globalIndex = offset + index;
            const mysqlId = row[idColumn];
            const uniqueId = `ext_${tableId}_${globalIndex}` + (mysqlId ? `_${mysqlId}` : '');

            const virtualData = virtualDataMap[uniqueId] || {};
            const mergedData = { ...row };

            for (const vc of virtualColumns) {
              const colId = String(vc.id);
              if (virtualData[colId] !== undefined) {
                mergedData[colId] = virtualData[colId];
              } else if (vc.default_value !== null && vc.default_value !== undefined) {
                mergedData[colId] = vc.default_value;
              }
            }

            return {
              id: uniqueId,
              table_id: tableId,
              data: mergedData,
              originalId: mysqlId,
              created_at: row.created_at || new Date().toISOString(),
              updated_at: row.updated_at || new Date().toISOString()
            };
          });

          await connection.end();

          return await sendRows({
            rows,
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total,
              pages
            }
          });
        } catch (mysqlError) {
          await connection.end();
          throw mysqlError;
        }
      }
    }

    // Fallback to local table_rows
    let whereClause = 'WHERE table_id = ?';
    const queryParams = [tableId];
    const countParams = [tableId];

    if (search) {
      const searchTerm = `%${String(search).toLowerCase()}%`;
      if (searchColumns) {
        const cols = String(searchColumns).split(',').map(c => c.trim());
        const conditions = cols.map(col => `LOWER(data::jsonb->>'${col.replace(/'/g, "''")}') LIKE ?`);
        whereClause += ` AND (${conditions.join(' OR ')})`;
        cols.forEach(() => {
          queryParams.push(searchTerm);
          countParams.push(searchTerm);
        });
      } else {
        whereClause += ` AND LOWER(data::text) LIKE ?`;
        queryParams.push(searchTerm);
        countParams.push(searchTerm);
      }
    }

    if (filterObj && Object.keys(filterObj).length > 0) {
      for (const [col, val] of Object.entries(filterObj)) {
        if (!/^[a-zA-Z0-9_]+$/.test(col)) {
          apiLogger.warn({ col }, 'Invalid filter column key rejected');
          continue;
        }
        whereClause += ` AND (data::jsonb->>'${col.replace(/'/g, "''")}' = ? OR CAST(data::jsonb->>'${col.replace(/'/g, "''")}' AS TEXT) = ?)`;
        queryParams.push(String(val), String(val));
        countParams.push(String(val), String(val));
      }
    }

    const sorting = sortingSchema.safeParse(req.query);
    if (!sorting.success) return error(res, 'INVALID_SORT', 'Provide a column ID and asc/desc direction together', 400);
    const { sortColumn, sortDirection } = sorting.data;
    const columns = await dbAll(
      'SELECT id, column_name, type FROM table_columns WHERE table_id = ?',
      [tableId]
    );

    // ADR-151 Slice A: if this table has a typed `order` column, default-sort
    // ascending by it (NULLs/unset last), tie-broken by created_at DESC. Gated:
    // tables with no `order` column keep the historical `ORDER BY created_at
    // DESC` byte-for-byte. The numeric cast is regex-guarded so a dirty/empty
    // cell can never throw and break the list (cf. the doc_* floor-guard ethos).
    let orderByClause = 'ORDER BY created_at DESC';
    if (sortColumn) {
      const rowField = {
        __sys_created_at: 'created_at', __sys_updated_at: 'updated_at',
        __row_id: 'id', __base_id: 'base_id',
      }[sortColumn];
      let expression = rowField;
      if (!rowField) {
        const column = columns.find(col => String(col.id) === sortColumn);
        if (!column) return error(res, 'INVALID_SORT', 'Sort column does not belong to this table', 400);
        // Current rows use field names; older rows can still use column IDs.
        // Bind JSON keys as values, never interpolate client input into SQL.
        const cell = 'COALESCE(data::jsonb->>?, data::jsonb->>?)';
        const keys = [column.column_name, String(column.id)];
        expression = cell;
        queryParams.push(...keys);
        if (column.type === 'number' || column.type === 'order') {
          expression = `(CASE WHEN BTRIM(${cell}) ~ ? THEN (${cell})::numeric END)`;
          queryParams.push('^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,4})?$', ...keys);
        }
      }
      orderByClause = `ORDER BY ${expression} ${sortDirection.toUpperCase()} NULLS LAST, created_at DESC, id DESC`;
    } else {
      const orderCol = await dbGet(
        `SELECT column_name FROM table_columns
         WHERE table_id = ? AND type = 'order'
         ORDER BY order_index ASC, id ASC
         LIMIT 1`,
        [tableId]
      );
      if (orderCol?.column_name && /^[a-zA-Z0-9_]+$/.test(orderCol.column_name)) {
        // ADR-151: consolidated into the shared helper (was an inline duplicate).
        orderByClause = `ORDER BY ${buildOrderClause(orderCol.column_name, {
          mode: 'guarded',
          tieBreak: 'created_at DESC',
        })}`;
      }
    }
    queryParams.push(Number(limit), offset);

    const rows = await dbAll(`
      SELECT
        id,
        base_id,
        table_id,
        data,
        created_at,
        updated_at
      FROM table_rows
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `, queryParams);

    const countResult = await dbGet(`
      SELECT COUNT(*) as total
      FROM table_rows
      ${whereClause}
    `, countParams);

    const total = Number(countResult?.total) || 0;
    const pages = Math.ceil(total / Number(limit));

    let idToNameMap = {};
    columns.forEach(col => {
      idToNameMap[String(col.id)] = col.column_name;
    });

    const parsedRows = rows.map(row => {
      const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

      let transformedData = { id: row.id };
      if (Object.keys(idToNameMap).length > 0) {
        for (const [key, value] of Object.entries(parsedData)) {
          const colName = idToNameMap[key] || key;
          transformedData[colName] = value;
        }
      } else {
        Object.assign(transformedData, parsedData);
      }

      return {
        ...row,
        data: transformedData
      };
    });

    return await sendRows({
      rows: parsedRows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/rows error');
    error(res, 'ROWS_FETCH_FAILED', err.message, 500);
  }
});

export default router;
