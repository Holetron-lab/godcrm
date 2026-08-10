/**
 * Tables feature — shared constants.
 *
 * Single source of truth for client-side limits that mirror backend caps.
 * Backend enforcement lives in `backend/routes/v3/tables/tableRowBatchController.js`
 * (BATCH_LIMIT_EXCEEDED structured error).
 */

/**
 * Max rows per single transactional batch update call
 * (`POST /api/v3/tables/:tableId/rows/batch-update`).
 *
 * Must stay in sync with `MAX_BATCH_SIZE` in
 * `backend/routes/v3/tables/tableRowBatchController.js`.
 *
 * Frontend pre-flight check (used by JsonColumnSettings.applyToRows
 * and useBulkReplace) blocks requests above this cap and shows a
 * user-facing modal/toast — never silently truncates.
 */
export const BATCH_UPDATE_LIMIT = 10000;

/** User-facing error message when the limit is exceeded. */
export const BATCH_UPDATE_LIMIT_MESSAGE = `Превышен лимит массовой замены (${BATCH_UPDATE_LIMIT.toLocaleString('ru-RU')} строк за раз)`;
